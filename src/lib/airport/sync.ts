import type { Prisma } from "@prisma/client";
import { detectFlightChange, jetSmartCanonicalNumber } from "@/lib/airport/flights";
import { planificarUnificacionJetSmart } from "@/lib/airport/dedupe";
import { deleteUnoccupiedFlight } from "@/lib/airport/flight-cleanup";
import { unificarFilasDeVuelo } from "@/lib/airport/flight-merge";
import { fechaLocal, type ProjectedFlight } from "@/lib/airport/projection";
import { estadoSegunHorario, fechaDelTablero, fetchFidsBoard, mapFidsStatus } from "@/lib/airport/fids";
import { fetchSchedules, type FlightDirection } from "@/lib/airport/provider";
import { esHorarioPublicado, fuentesRetiradas } from "@/lib/airport/data-quality";
import { prisma } from "@/lib/db/prisma";
import { reconciliarReservasDeVuelosPasados } from "@/lib/airport/reservation-cleanup";
import { getAirLabsKey } from "@/lib/settings/app-settings";
import { recordAuditBestEffort, type AuditActor } from "@/lib/audit/record";
import { guardarObservaciones, observacionDeAirLabs, observacionDelTablero, type ObservacionPendiente } from "@/lib/airport/observations";
import { aerolineaDelNumero, aerolineasEquivalentes, numeroCanonico } from "@/lib/airport/observation-match";

/**
 * Trae los vuelos de AirLabs y los guarda en `Flight`, registrando en `FlightEvent` cada
 * imprevisto detectado (demora, cancelación, desvío, adelanto). Es la pieza que hace que
 * los vuelos "se posteen solos" y que el botón del panel funcione de verdad.
 *
 * Sin clave o con error de red devuelve el detalle del error y NO rompe: la operación sigue
 * con lo que ya está cargado (modo degradado).
 */

const TZ_OFFSET_MIN = -180;
export const DIAS_A_SINCRONIZAR = 1;

export type SyncSummary = {
  corridas: number;
  creados: number;
  actualizados: number;
  eventos: number;
  /** Días futuros completados proyectando el patrón ya observado (AirLabs no publica futuros). */
  proyectados: number;
  /** Vuelos revisados contra el tablero del aeropuerto (cubre aerolíneas que AirLabs no tiene). */
  desdeTablero: number;
  /** Filas repetidas del mismo vuelo el mismo día que se unificaron (autocorrección). */
  limpiados: number;
  /** Filas proyectadas de un día que ya tiene datos reales: se descartan. */
  proyectadosLimpiados: number;
  /** Filas futuras sueltas cuya hora no era la del patrón y se corrigieron (issue #145). */
  realineados: number;
  /** Filas futuras que figuraban aterrizadas y volvieron a programadas: un vuelo que no salió no aterrizó. */
  estadosFuturosLimpiados: number;
  /** Vuelos de JetSMART guardados dos veces (JA y WJ) que se unificaron en una sola fila JA. */
  jetSmartUnificados: number;
  /** Vuelos que siguen repetidos porque más de una fila tiene reservas: los resuelve una persona. */
  repetidosConReservas: string[];
  errores: string[];
  /** Lecturas de cada fuente guardadas en `FlightObservation` (modo sombra) y cuántas difieren del sync. */
  observaciones?: { registradas: number; discrepancias: number };
};

/** Rango local (UTC-3) de un día, para saber si un día ya tiene datos reales. */
function rangoDelDia(dia: string): { desde: Date; hasta: Date } {
  const desde = new Date(`${dia}T00:00:00-03:00`);
  return { desde, hasta: new Date(desde.getTime() + 86400000) };
}

function diasDesdeHoy(dias: number): string[] {
  const ahora = new Date();
  const salida: string[] = [];
  for (let i = 0; i < dias; i += 1) {
    const d = new Date(ahora.getTime() + i * 86400000 + TZ_OFFSET_MIN * 60000);
    salida.push(d.toISOString().slice(0, 10));
  }
  return salida;
}

/**
 * Un día que ya tiene datos reales no debe seguir mostrando filas proyectadas: el pasajero vería
 * "Horario estimado" en el día del viaje, que es justo cuando el horario tiene que ser el real.
 * Nunca se borra una fila con reservas o combis asignadas: esa reserva sigue siendo operativa.
 */
async function limpiarProyectadosConDatosReales(dia: string): Promise<number> {
  const { desde, hasta } = rangoDelDia(dia);
  const reales = await prisma.flight.count({
    where: { scheduledAt: { gte: desde, lt: hasta }, source: { in: ["API", "FIDS", "MANUAL"] } }
  });
  // Sin ningún dato real, la proyección es lo único que hay: se respeta.
  if (reales === 0) return 0;

  const proyectados = await prisma.flight.findMany({
    where: { scheduledAt: { gte: desde, lt: hasta }, source: "ESTIMADO" },
    include: { _count: { select: { reservations: true, assignments: true } } }
  });

  let borrados = 0;
  for (const fila of proyectados) {
    if (fila._count.reservations > 0 || fila._count.assignments > 0) continue;
    borrados += await deleteUnoccupiedFlight(fila.id);
  }

  return borrados;
}

/**
 * Un vuelo que todavía no salió no puede estar aterrizado.
 *
 * El tablero se actualizaba con la fecha mal inferida y dejaba el estado `LANDED` en la fila del
 * día siguiente —el vuelo aparecía «ya pasó» en el panel antes de despegar—. La inferencia ya está
 * corregida; esto limpia lo que quedó escrito mientras el bug existió, y queda como red de
 * seguridad para cualquier otra fuente que escriba un estado imposible.
 */
async function limpiarEstadosQueNoPudieronOcurrir(ahora: Date = new Date()): Promise<number> {
  const { count } = await prisma.flight.updateMany({
    where: { scheduledAt: { gt: ahora }, status: "LANDED" },
    data: { status: "SCHEDULED" }
  });
  return count;
}

async function unificarJetSmartRepetidos(resumen: SyncSummary): Promise<void> {
  const { desde } = rangoDelDia(diasDesdeHoy(1)[0]);
  const filas = await prisma.flight.findMany({
    where: { scheduledAt: { gte: desde, lt: new Date(desde.getTime() + 86400000) }, source: { notIn: fuentesRetiradas }, OR: [{ number: { startsWith: "JA" } }, { number: { startsWith: "WJ" } }] },
    select: {
      id: true,
      number: true,
      direction: true,
      scheduledAt: true,
      source: true,
      updatedAt: true,
      _count: { select: { reservations: true, assignments: true } }
    }
  });

  const entradas = filas.map((f) => ({
    id: f.id,
    number: f.number,
    direction: f.direction,
    dia: fechaLocal(f.scheduledAt),
    source: f.source,
    updatedAt: f.updatedAt,
    reservas: f._count.reservations,
    combis: f._count.assignments
  }));
  const plan = planificarUnificacionJetSmart(entradas);

  // Se unifica por vuelo y día: borrar la fila repetida sin más perdería lo que esa fila sabía
  // (estado del tablero, horario nuevo, notas de coordinación, eventos de imprevisto).
  const aBorrar = new Set(plan.borrar);
  const grupos = new Map<string, string[]>();
  for (const fila of entradas) {
    const canonico = jetSmartCanonicalNumber(fila.number);
    if (!canonico) continue;
    const clave = `${canonico}|${fila.direction}|${fila.dia}`;
    const ids = grupos.get(clave);
    if (ids) ids.push(fila.id);
    else grupos.set(clave, [fila.id]);
  }
  for (const [clave, ids] of grupos) {
    const borrar = ids.filter((id) => aBorrar.has(id));
    if (borrar.length === 0) continue;
    try {
      const { borrados } = await unificarFilasDeVuelo(ids, borrar);
      resumen.jetSmartUnificados += borrados;
    } catch (error) {
      const [canonico] = clave.split("|");
      resumen.errores.push(`unificar ${canonico}: ${error instanceof Error ? error.message : "error"}`);
    }
  }
  for (const { id, number } of plan.renombrar) {
    try {
      await prisma.flight.update({ where: { id }, data: { number, airline: "JA" } });
      resumen.jetSmartUnificados += 1;
    } catch (error) {
      resumen.errores.push(`unificar ${number}: ${error instanceof Error ? error.message : "error"}`);
    }
  }
  for (const r of plan.conReservasRepetidas) {
    resumen.repetidosConReservas.push(`${r.number} ${r.direction} ${r.dia} (${r.ids.length} filas con reservas)`);
  }
}

/**
 * Un vuelo proyectado vale mientras el patrón lo justifique.
 *
 * Cuando se conocen más días de un servicio, la proyección deja de generarlo —pero la fila vieja
 * seguía en la base para siempre, porque la única limpieza que había borra los ESTIMADO de los días
 * que ya tienen datos reales, y un día futuro nunca los tiene.
 *
 * Se veía en el tablero: el 17/11 mostraba 5 arribos y 6 partidas. AR1655 estaba proyectado sin su
 * AR1654, que es el mismo avión: el que llega es el que después sale.
 *
 * Sólo se borra lo que es proyección (ESTIMADO) y no tiene ninguna reserva encima: si alguien
 * reservó, la fila se queda y la resuelve una persona.
 */
export async function limpiarProyectadosQueYaNoCorresponden(
  dia: string,
  vigentes: ProjectedFlight[]
): Promise<number> {
  const { desde, hasta } = rangoDelDia(dia);
  const esperados = new Set(vigentes.map((p) => `${p.number}|${p.direction}`));
  const existentes = await prisma.flight.findMany({
    where: { source: "ESTIMADO", scheduledAt: { gte: desde, lt: hasta } },
    select: { id: true, number: true, direction: true }
  });
  const sobrantes = existentes.filter((f) => !esperados.has(`${f.number}|${f.direction}`));
  if (sobrantes.length === 0) return 0;

  const conReserva = new Set(
    (
      await prisma.airportReservationDetails.findMany({
        where: { flightId: { in: sobrantes.map((f) => f.id) } },
        select: { flightId: true }
      })
    ).map((r) => r.flightId)
  );

  let borrados = 0;
  for (const fila of sobrantes) {
    if (conReserva.has(fila.id)) continue;
    await prisma.flight.delete({ where: { id: fila.id } });
    borrados += 1;
  }
  return borrados;
}

export async function syncAirportFlights(opts: { days?: number; actor?: AuditActor | null } = {}): Promise<SyncSummary> {
  const resumen: SyncSummary = { corridas: 0, creados: 0, actualizados: 0, eventos: 0, proyectados: 0, desdeTablero: 0, limpiados: 0, proyectadosLimpiados: 0, realineados: 0, estadosFuturosLimpiados: 0, jetSmartUnificados: 0, repetidosConReservas: [], errores: [] };
  const direcciones: FlightDirection[] = ["ARRIVAL", "DEPARTURE"];
  const apiKey = await getAirLabsKey();
  // Modo sombra: cada lectura de cada fuente, con lo que el sync hizo con ella. No decide nada.
  const syncRunId = crypto.randomUUID();
  const lecturas: ObservacionPendiente[] = [];

  await unificarJetSmartRepetidos(resumen);

  for (const dia of diasDesdeHoy(Math.min(opts.days ?? DIAS_A_SINCRONIZAR, 1))) {
    for (const direction of direcciones) {
      const { flights, error, raw } = await fetchSchedules(direction, dia, apiKey);
      resumen.corridas += 1;
      if (error) {
        resumen.errores.push(`${direction} ${dia}: ${error}`);
        continue;
      }

      // Qué pasó con cada vuelo normalizado, para atribuírselo a las lecturas crudas de AirLabs.
      const aplicados = new Map<string, { outcome: "CREADO" | "ACTUALIZADO" | "PENDIENTE_DE_CONFIRMACION"; flightId: string | null; status: string }>();
      const claveApi = (numero: string, horario: Date) => `${numeroCanonico(numero)}|${horario.getTime()}`;

      for (const vuelo of flights) {
        // Mismo número y sentido ese día = el mismo vuelo, aunque el horario haya cambiado entre
        // fuentes: si AirLabs publica el horario viejo y el aeropuerto el nuevo, no son dos vuelos.
        const { desde: inicioDia, hasta: finDia } = rangoDelDia(dia);
        const canonico = jetSmartCanonicalNumber(vuelo.number);
        const identidad = {
          number: canonico ? { in: [canonico, `WJ${canonico.slice(2)}`] } : vuelo.number,
          direction: vuelo.direction,
          scheduledAt: { gte: inicioDia, lt: finDia }
        };
        let previo = await prisma.flight.findFirst({ where: identidad });
        if (previo && fuentesRetiradas.includes(previo.source)) {
          // Puede coexistir un duplicado retirado con el vuelo publicado de ese día.
          previo = await prisma.flight.findFirst({ where: { ...identidad, source: { notIn: fuentesRetiradas } } }) ?? previo;
        }

        // Las lecturas de AirLabs quedan en el historial. Una sugerencia de horario por sí
        // sola no vuelve a poner a la venta un vuelo ausente de la programación de CPC.
        const comercial = /^(AR|JA|WJ)\d+$/.test(vuelo.number);
        if (fuentesRetiradas.includes(previo?.source ?? "") ||
            (comercial && (!previo || previo.source === "ESTIMADO") && vuelo.status === "SCHEDULED")) {
          aplicados.set(claveApi(vuelo.number, vuelo.scheduledAt), {
            outcome: "PENDIENTE_DE_CONFIRMACION", flightId: previo?.id ?? null, status: vuelo.status
          });
          continue;
        }

        if (!previo) {
          const { count } = await prisma.flight.createMany({
            skipDuplicates: true,
            data: {
              number: vuelo.number,
              airline: vuelo.airline,
              origin: vuelo.origin,
              destination: vuelo.destination,
              direction: vuelo.direction,
              scheduledAt: vuelo.scheduledAt,
              estimatedAt: vuelo.estimatedAt,
              status: vuelo.status,
              externalId: vuelo.externalId,
              lastCheckedAt: new Date(),
              source: "API"
            }
          });
          resumen.creados += count;
          aplicados.set(claveApi(vuelo.number, vuelo.scheduledAt), { outcome: "CREADO", flightId: null, status: vuelo.status });
          continue;
        }

        aplicados.set(claveApi(vuelo.number, vuelo.scheduledAt), { outcome: "ACTUALIZADO", flightId: previo.id, status: vuelo.status });
        const publicado = esHorarioPublicado(previo.source);
        const horario = publicado ? previo.scheduledAt : vuelo.scheduledAt;
        const estado = publicado && vuelo.status === "SCHEDULED" ? previo.status : vuelo.status;
        const estima = publicado ? (vuelo.estimatedAt ?? previo.estimatedAt) : vuelo.estimatedAt;
        const cambio = detectFlightChange(
          { status: previo.status, scheduledAt: previo.scheduledAt, estimatedAt: previo.estimatedAt },
          { status: estado, scheduledAt: horario, estimatedAt: estima }
        );

        await prisma.flight.update({
          where: { id: previo.id },
          data: {
            status: estado,
            scheduledAt: horario,
            estimatedAt: estima,
            ...(!publicado && { airline: vuelo.airline, origin: vuelo.origin, destination: vuelo.destination,
              externalId: vuelo.externalId, source: "API" }),
            lastCheckedAt: new Date(),
            ...(cambio
              ? { events: { create: { kind: cambio.kind, fromValue: cambio.fromValue, toValue: cambio.toValue } } }
              : {})
          }
        });

        if (cambio) resumen.eventos += 1;
        resumen.actualizados += 1;
      }

      // Las lecturas crudas incluyen los códigos compartidos y los WJ que la normalización descarta.
      for (const item of raw ?? []) {
        const lectura = observacionDeAirLabs(item, direction);
        if (!lectura) continue;
        const aplicado = lectura.scheduledAt ? aplicados.get(claveApi(lectura.rawNumber, lectura.scheduledAt)) : undefined;
        if (aplicado) {
          lectura.outcome = aplicado.outcome;
          lectura.flightId = aplicado.flightId;
          lectura.status = aplicado.status;
        } else {
          lectura.outcome = lectura.codeshareOf ? "DESCARTADO_CODIGO_COMPARTIDO" : "DESCARTADO_DUPLICADO_PROVEEDOR";
        }
        lecturas.push(lectura);
      }
    }
  }

  // Tablero del aeropuerto: complementa lo que AirLabs no cubre (American Jet, por ejemplo) y trae
  // los estados del propio aeropuerto. Se actualiza el vuelo existente por número y día.
  for (const direction of direcciones) {
    const { flights: delTablero, error } = await fetchFidsBoard(direction);
    resumen.corridas += 1;
    if (error) {
      resumen.errores.push(`tablero ${direction}: ${error}`);
      continue;
    }

    // Procesar primero las filas JA para que una fila WJ del mismo día no las pise.
    const tablero = delTablero.map((f) => ({ f, canonical: jetSmartCanonicalNumber(f.number) }));
    tablero.sort((a, b) => Number(b.canonical === b.f.number) - Number(a.canonical === a.f.number));
    const vistos = new Set<string>();

    for (const { f, canonical } of tablero) {
      // Se registra antes de cualquier descarte: lo que el sync saltea es justo lo que hay que ver.
      const lectura = observacionDelTablero(f, direction);
      lecturas.push(lectura);
      const estadoDelTablero = mapFidsStatus(f);
      // El estado entra en la cuenta de la fecha: un vuelo que ya aterrizó es de hoy, no de mañana.
      const fecha = fechaDelTablero(f.scheduled, new Date(), estadoDelTablero);
      if (!fecha) {
        lectura.outcome = "SIN_FECHA";
        continue;
      }
      const number = canonical ?? f.number;
      const airline = canonical ? "JA" : f.airlineCode;
      const clave = `${fecha}|${number}`;
      const scheduledAt = new Date(`${fecha}T${f.scheduled}:00-03:00`);
      const estimatedAt = f.estimated ? new Date(`${fecha}T${f.estimated}:00-03:00`) : null;
      // El estado declarado por el tablero, corregido con los horarios: si la estima se corrió
      // 30 min o más, es una demora aunque el tablero diga "Pre Embarque" o "En horario".
      const estado = estadoSegunHorario(estadoDelTablero, scheduledAt, estimatedAt);
      Object.assign(lectura, { localDay: fecha, scheduledAt, estimatedAt, status: estado });
      if (fecha !== fechaLocal(new Date())) {
        lectura.outcome = "FECHA_FUTURA_INFERIDA";
        continue;
      }
      if (canonical && vistos.has(clave)) {
        lectura.outcome = "REPETIDO_EN_TABLERO";
        continue;
      }
      if (canonical) vistos.add(clave);

      // Mismo número y día observado: buscar la fila existente antes de usar este dato sin fecha.
      const desdeElDia = new Date(`${fecha}T00:00:00-03:00`);
      const hastaElDia = new Date(desdeElDia.getTime() + 86400000);
      const filasDelVuelo = await prisma.flight.findMany({
        where: { number: canonical ? { in: [number, `WJ${number.slice(2)}`] } : number, direction, scheduledAt: { gte: desdeElDia, lt: hastaElDia } },
        include: { _count: { select: { reservations: true, assignments: true } } }
      });

      const candidatos = filasDelVuelo.filter(v => !fuentesRetiradas.includes(v.source));
      if (!candidatos.length && filasDelVuelo.length) {
        lectura.outcome = "PENDIENTE_DE_CONFIRMACION";
        lectura.flightId = filasDelVuelo[0].id;
        continue;
      }

      // El tablero no tiene fecha de vuelo: complementa el HORARIO de la API consultada en esta
      // misma jornada, pero **no su estado**. Antes se salteaba entero, y como AirLabs trae los
      // vuelos de CPC con su horario y despues nunca los confirma (arr_iata=CPC devuelve 0 vuelos),
      // el tablero mostraba «Programado» vuelos que el aeropuerto ya daba por aterrizados hacia horas.
      // El FIDS es el tablero oficial del aeropuerto: si dice que aterrizo, aterrizo.
      const deLaApi = candidatos.find((v) => esHorarioPublicado(v.source)) ?? candidatos.find(
        (v) => v.source === "API" && v.lastCheckedAt && fechaLocal(v.lastCheckedAt) === fecha
      );
      if (deLaApi) {
        lectura.outcome = "ESTADO_SOBRE_API";
        lectura.flightId = deLaApi.id;
        const peso: Record<string, number> = { SCHEDULED: 0, DELAYED: 0, EN_ROUTE: 1, LANDED: 2, DIVERTED: 2, CANCELLED: 2 };
        // Nunca retroceder: un LANDED no vuelve a EN_ROUTE porque el tablero tarde en refrescar.
        const conservaHorario = esHorarioPublicado(deLaApi.source);
        const estima = conservaHorario ? (estimatedAt ?? deLaApi.estimatedAt) : deLaApi.estimatedAt;
        if ((estado !== deLaApi.status || estima?.getTime() !== deLaApi.estimatedAt?.getTime()) &&
            (peso[estado] ?? 0) >= (peso[deLaApi.status] ?? 0)) {
          const cambio = detectFlightChange(
            { status: deLaApi.status, scheduledAt: deLaApi.scheduledAt, estimatedAt: deLaApi.estimatedAt },
            { status: estado, scheduledAt: deLaApi.scheduledAt, estimatedAt: estima }
          );
          await prisma.flight.update({
            where: { id: deLaApi.id },
            data: {
              status: estado,
              estimatedAt: estima,
              lastCheckedAt: new Date(),
              ...(cambio
                ? { events: { create: { kind: cambio.kind, fromValue: cambio.fromValue, toValue: cambio.toValue } } }
                : {})
            }
          });
          resumen.eventos += cambio ? 1 : 0;
        }
        continue;
      }

      // Autocorrección: si el mismo vuelo quedó repetido ese día (por ejemplo una fila con el
      // horario viejo de la API y otra con el del tablero), se conserva la más parecida al tablero
      // y se borran las demás. Nunca se borra una fila con reservas o combis asignadas.
      const propio = candidatos.reduce<(typeof candidatos)[number] | null>((mejor, c) => {
        if (!mejor) return c;
        const dC = Math.abs(c.scheduledAt.getTime() - scheduledAt.getTime());
        const dM = Math.abs(mejor.scheduledAt.getTime() - scheduledAt.getTime());
        return dC < dM ? c : mejor;
      }, null);
      for (const c of candidatos) {
        if (propio && c.id !== propio.id && c._count.reservations === 0 && c._count.assignments === 0) {
          resumen.limpiados += await deleteUnoccupiedFlight(c.id);
        }
      }
      if (propio) {
        lectura.outcome = "ACTUALIZADO";
        lectura.flightId = propio.id;
        const cambio = detectFlightChange(
          { status: propio.status, scheduledAt: propio.scheduledAt, estimatedAt: propio.estimatedAt },
          { status: estado, scheduledAt, estimatedAt }
        );
        await prisma.flight.update({
          where: { id: propio.id },
          data: {
            status: estado,
            estimatedAt,
            airline,
            origin: propio.origin && propio.origin !== "—" ? propio.origin : f.city || "—",
            source: "FIDS",
            lastCheckedAt: new Date(),
            scheduledAt,
            ...(cambio
              ? { events: { create: { kind: cambio.kind, fromValue: cambio.fromValue, toValue: cambio.toValue } } }
              : {})
          }
        });
        if (cambio) resumen.eventos += 1;
        resumen.actualizados += 1;
        resumen.desdeTablero += 1;

        continue;
      }

      // Sólo un vuelo de la misma aerolínea puede ser el mismo vuelo con otro número. Sin este
      // filtro, AR1656/AR1657 del tablero se descartaban por estar a 25 minutos de AJ324/AJ325
      // (otra empresa, otra ruta) y desaparecían de la grilla cuando AirLabs no los traía.
      const aerolineasDelVuelo = aerolineasEquivalentes(f.airlineCode || aerolineaDelNumero(number));
      const gemelo = canonical || aerolineasDelVuelo.length === 0 ? null : await prisma.flight.findFirst({
        where: {
          direction,
          airline: { in: aerolineasDelVuelo },
          scheduledAt: {
            gte: new Date(scheduledAt.getTime() - 25 * 60000),
            lte: new Date(scheduledAt.getTime() + 25 * 60000)
          },
          source: { notIn: fuentesRetiradas }
        }
      });
      if (gemelo) {
        // Queda registrado contra qué fila se descartó, para ver si se perdió un vuelo real.
        lectura.outcome = "DESCARTADO_GEMELO";
        lectura.payload = { ...(lectura.payload as Record<string, unknown>), gemelo: gemelo.id, gemeloNumero: gemelo.number } as Prisma.InputJsonValue;
        continue;
      }

      const { count } = await prisma.flight.createMany({
        skipDuplicates: true,
        data: {
          number,
          airline,
          origin: f.city || "—",
          destination: direction === "ARRIVAL" ? "Aeropuerto Chapelco (CPC)" : f.city || "—",
          direction,
          scheduledAt,
          estimatedAt,
          status: estado,
          source: "FIDS",
          lastCheckedAt: new Date()
        }
      });
      resumen.creados += count;
      resumen.desdeTablero += count;
      lectura.outcome = "CREADO";
    }
  }


  // El día en curso tiene que mostrar horarios reales: si quedaron filas proyectadas de cuando ese
  // día todavía era futuro, se descartan una vez que hay dato de la API o del tablero.
  for (const dia of diasDesdeHoy(Math.min(opts.days ?? DIAS_A_SINCRONIZAR, 1))) {
    resumen.proyectadosLimpiados += await limpiarProyectadosConDatosReales(dia);
  }
  resumen.estadosFuturosLimpiados += await limpiarEstadosQueNoPudieronOcurrir();

  // Registrar las lecturas y su asociación contra la grilla del día.
  resumen.observaciones = await guardarObservaciones(syncRunId, lecturas);

  // El sync es el único proceso que corre todos los días sin que nadie lo pida: es el lugar para
  // cerrar las reservas de vuelos que ya pasaron y quedaron abiertas.
  const reservas = await reconciliarReservasDeVuelosPasados();
  if (reservas.confirmadas > 0 || reservas.canceladas > 0) {
    resumen.repetidosConReservas.push(
      `reservas cerradas: ${reservas.confirmadas} confirmadas (pago aprobado), ${reservas.canceladas} canceladas (vuelo pasado sin pago)`
    );
  }

  // Una fila por sincronización que tocó algo (o que alguien pidió a mano): qué creó, cambió y borró.
  const cambios = {
    creados: resumen.creados, actualizados: resumen.actualizados, eventos: resumen.eventos, proyectados: resumen.proyectados,
    limpiados: resumen.limpiados, proyectadosLimpiados: resumen.proyectadosLimpiados, realineados: resumen.realineados,
    estadosFuturosLimpiados: resumen.estadosFuturosLimpiados, jetSmartUnificados: resumen.jetSmartUnificados
  };
  const tocados = Object.entries(cambios).filter(([, cantidad]) => cantidad > 0);
  if (tocados.length > 0 || opts.actor) {
    await recordAuditBestEffort(prisma, {
      actor: opts.actor ?? null, action: "UPDATE", entity: "AIRPORT", entityLabel: "Sincronización de vuelos",
      summary: `${opts.actor ? "Sincronización de vuelos pedida a mano" : "Sincronización automática de vuelos"}: ${
        tocados.length ? tocados.map(([nombre, cantidad]) => `${cantidad} ${nombre}`).join(", ") : "sin cambios"
      }${resumen.errores.length ? `. Errores: ${resumen.errores.length}` : ""}.`
    });
  }

  return resumen;
}
