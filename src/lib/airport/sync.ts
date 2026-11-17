import { detectFlightChange, jetSmartCanonicalNumber } from "@/lib/airport/flights";
import { planificarUnificacionJetSmart } from "@/lib/airport/dedupe";
import { deleteUnoccupiedFlight } from "@/lib/airport/flight-cleanup";
import { unificarFilasDeVuelo } from "@/lib/airport/flight-merge";
import { debeRealinear, diaDeLaSemana, DIAS_PROYECTADOS, esGemeloHorario, fechaLocal, horaLocal, mismaFrecuenciaSemanal, proyectarVuelos, type ProjectedFlight } from "@/lib/airport/projection";
import { estadoSegunHorario, fechaDelTablero, fetchFidsBoard, mapFidsStatus } from "@/lib/airport/fids";
import { fetchSchedules, type FlightDirection } from "@/lib/airport/provider";
import { VUELOS_QUE_NO_SE_OFRECEN } from "@/lib/airport/offered-flights";
import { prisma } from "@/lib/db/prisma";
import { reconciliarReservasDeVuelosPasados } from "@/lib/airport/reservation-cleanup";
import { getAirLabsKey } from "@/lib/settings/app-settings";
import { recordAuditBestEffort, type AuditActor } from "@/lib/audit/record";

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
 * Unifica los vuelos de JetSMART que quedaron guardados dos veces (JA3184 del tablero y WJ3184 de
 * la API, y sus proyecciones), de hoy en adelante. Corre antes de sincronizar para que las
 * búsquedas por número encuentren una sola fila. Nunca borra una fila con reservas o combis.
 */
/**
 * Corrige las filas `ESTIMADO` futuras que quedaron con la hora de otro día.
 *
 * No toca una fila con reservas o combi asignada: ahí la hora la decidió una persona y manda. Si el
 * día tiene más de una fila del mismo vuelo tampoco se toca: ése es un duplicado y lo resuelve la
 * unificación, no este paso.
 */
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

async function realinearGrillaFutura(
  observados: { number: string; direction: string; scheduledAt: Date; source: string; airline: string | null; origin: string; destination: string }[]
): Promise<number> {
  let corregidos = 0;

  // Se usa el patrón que `proyectarVuelos` ya aplica a los días nuevos: la ocurrencia más reciente
  // del vuelo (o la del mismo día de la semana si se conoce). Alinear las filas viejas a **ese**
  // patrón deja la grilla consistente; el dato definitivo lo trae el tablero el día del vuelo.
  // Ojo: las propias `ESTIMADO` no sirven como referencia, o la grilla mala se valida a sí misma.
  const referencia = observados.filter((o) => o.source !== "ESTIMADO");

  for (const dia of diasDesdeHoy(DIAS_PROYECTADOS + 1).slice(1)) {
    const { desde, hasta } = rangoDelDia(dia);

    for (const esperado of proyectarVuelos(dia, referencia)) {
      const filas = await prisma.flight.findMany({
        where: {
          number: esperado.number,
          direction: esperado.direction,
          scheduledAt: { gte: desde, lt: hasta }
        },
        select: {
          id: true,
          scheduledAt: true,
          source: true,
          _count: { select: { reservations: true, assignments: true } }
        }
      });
      if (filas.length !== 1) continue;

      const [fila] = filas;
      if (
        !debeRealinear(
          {
            source: fila.source,
            scheduledAt: fila.scheduledAt,
            reservas: fila._count.reservations,
            assignments: fila._count.assignments
          },
          esperado.scheduledAt
        )
      ) {
        continue;
      }

      await prisma.flight.update({
        where: { id: fila.id },
        data: { scheduledAt: esperado.scheduledAt, estimatedAt: null }
      });
      corregidos += 1;
    }
  }

  return corregidos;
}

async function unificarJetSmartRepetidos(resumen: SyncSummary): Promise<void> {
  const { desde } = rangoDelDia(diasDesdeHoy(1)[0]);
  const filas = await prisma.flight.findMany({
    where: { scheduledAt: { gte: desde }, OR: [{ number: { startsWith: "JA" } }, { number: { startsWith: "WJ" } }] },
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

  await unificarJetSmartRepetidos(resumen);

  for (const dia of diasDesdeHoy(Math.min(opts.days ?? DIAS_A_SINCRONIZAR, 1))) {
    for (const direction of direcciones) {
      const { flights, error } = await fetchSchedules(direction, dia, apiKey);
      resumen.corridas += 1;
      if (error) {
        resumen.errores.push(`${direction} ${dia}: ${error}`);
        continue;
      }

      for (const vuelo of flights) {
        // Mismo número y sentido ese día = el mismo vuelo, aunque el horario haya cambiado entre
        // fuentes: si AirLabs publica el horario viejo y el aeropuerto el nuevo, no son dos vuelos.
        const { desde: inicioDia, hasta: finDia } = rangoDelDia(dia);
        const previo = await prisma.flight.findFirst({
          where: {
            number: vuelo.number,
            direction: vuelo.direction,
            scheduledAt: { gte: inicioDia, lt: finDia }
          }
        });

        // AirLabs fecha cada vuelo. Un dato FIDS previo no bloquea una lectura actual de la API.

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
          continue;
        }

        const cambio = detectFlightChange(
          { status: previo.status, scheduledAt: previo.scheduledAt, estimatedAt: previo.estimatedAt },
          { status: vuelo.status, scheduledAt: vuelo.scheduledAt, estimatedAt: vuelo.estimatedAt }
        );

        await prisma.flight.update({
          where: { id: previo.id },
          data: {
            status: vuelo.status,
            scheduledAt: vuelo.scheduledAt,
            estimatedAt: vuelo.estimatedAt,
            airline: vuelo.airline,
            origin: vuelo.origin,
            externalId: vuelo.externalId,
            lastCheckedAt: new Date(),
            source: "API",
            ...(cambio
              ? { events: { create: { kind: cambio.kind, fromValue: cambio.fromValue, toValue: cambio.toValue } } }
              : {})
          }
        });

        if (cambio) resumen.eventos += 1;
        resumen.actualizados += 1;
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
      const estadoDelTablero = mapFidsStatus(f);
      // El estado entra en la cuenta de la fecha: un vuelo que ya aterrizó es de hoy, no de mañana.
      const fecha = fechaDelTablero(f.scheduled, new Date(), estadoDelTablero);
      if (!fecha) continue;
      const number = canonical ?? f.number;
      const airline = canonical ? "JA" : f.airlineCode;
      const clave = `${fecha}|${number}`;
      if (canonical && vistos.has(clave)) continue;
      if (canonical) vistos.add(clave);
      const scheduledAt = new Date(`${fecha}T${f.scheduled}:00-03:00`);
      const estimatedAt = f.estimated ? new Date(`${fecha}T${f.estimated}:00-03:00`) : null;
      // El estado declarado por el tablero, corregido con los horarios: si la estima se corrió
      // 30 min o más, es una demora aunque el tablero diga "Pre Embarque" o "En horario".
      const estado = estadoSegunHorario(estadoDelTablero, scheduledAt, estimatedAt);

      // Mismo número y día observado: buscar la fila existente antes de usar este dato sin fecha.
      const desdeElDia = new Date(`${fecha}T00:00:00-03:00`);
      const hastaElDia = new Date(desdeElDia.getTime() + 86400000);
      const candidatos = await prisma.flight.findMany({
        where: { number, direction, scheduledAt: { gte: desdeElDia, lt: hastaElDia } },
        include: { _count: { select: { reservations: true, assignments: true } } }
      });

      // El tablero no tiene fecha de vuelo: complementa el HORARIO de la API consultada en esta
      // misma jornada, pero **no su estado**. Antes se salteaba entero, y como AirLabs trae los
      // vuelos de CPC con su horario y despues nunca los confirma (arr_iata=CPC devuelve 0 vuelos),
      // el tablero mostraba «Programado» vuelos que el aeropuerto ya daba por aterrizados hacia horas.
      // El FIDS es el tablero oficial del aeropuerto: si dice que aterrizo, aterrizo.
      const deLaApi = candidatos.find(
        (v) => v.source === "API" && v.lastCheckedAt && fechaLocal(v.lastCheckedAt) === fecha
      );
      if (deLaApi) {
        const peso: Record<string, number> = { SCHEDULED: 0, DELAYED: 0, EN_ROUTE: 1, LANDED: 2, DIVERTED: 2, CANCELLED: 2 };
        // Nunca retroceder: un LANDED no vuelve a EN_ROUTE porque el tablero tarde en refrescar.
        if (estado !== deLaApi.status && (peso[estado] ?? 0) >= (peso[deLaApi.status] ?? 0)) {
          const cambio = detectFlightChange(
            { status: deLaApi.status, scheduledAt: deLaApi.scheduledAt, estimatedAt: deLaApi.estimatedAt },
            { status: estado, scheduledAt: deLaApi.scheduledAt, estimatedAt: deLaApi.estimatedAt }
          );
          await prisma.flight.update({
            where: { id: deLaApi.id },
            data: {
              status: estado,
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

        // Si el aeropuerto corrigió el horario de hoy, se alinea la grilla futura **del mismo día
        // de la semana**: ese es el mismo servicio y el dato del tablero es fresco. Los demás días
        // tienen su propio horario (JetSMART sale 12:37 un sábado y 13:50 un domingo), y copiarles
        // el reloj de hoy dejaba el vuelo de mañana 73 minutos antes de su horario real
        // (reporte de Flor, 14-nov).
        {
          const diaDelTablero = fechaLocal(scheduledAt);
          const futuros = await prisma.flight.findMany({
            where: { number, direction, source: "ESTIMADO", scheduledAt: { gte: hastaElDia } },
            select: { id: true, scheduledAt: true }
          });
          for (const fut of futuros) {
            const fechaFutura = fechaLocal(fut.scheduledAt);
            if (!mismaFrecuenciaSemanal(fechaFutura, diaDelTablero)) continue;
            const horaFutura = horaLocal(fut.scheduledAt);
            if (horaFutura === f.scheduled) continue; // ya está alineado
            const destino = new Date(`${fechaFutura}T${f.scheduled}:00-03:00`);
            const ocupado = await prisma.flight.findFirst({
              where: {
                number,
                direction,
                scheduledAt: { gte: new Date(destino.getTime() - 60000), lte: new Date(destino.getTime() + 60000) },
                id: { not: fut.id }
              }
            });
            if (ocupado) continue;
            await prisma.flight.update({ where: { id: fut.id }, data: { scheduledAt: destino } });
          }
        }

        continue;
      }

      const gemelo = canonical ? null : await prisma.flight.findFirst({
        where: {
          direction,
          scheduledAt: {
            gte: new Date(scheduledAt.getTime() - 25 * 60000),
            lte: new Date(scheduledAt.getTime() + 25 * 60000)
          }
        }
      });
      if (gemelo) continue;

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
    }
  }

  // El día en curso tiene que mostrar horarios reales: si quedaron filas proyectadas de cuando ese
  // día todavía era futuro, se descartan una vez que hay dato de la API o del tablero.
  for (const dia of diasDesdeHoy(Math.min(opts.days ?? DIAS_A_SINCRONIZAR, 1))) {
    resumen.proyectadosLimpiados += await limpiarProyectadosConDatosReales(dia);
  resumen.estadosFuturosLimpiados += await limpiarEstadosQueNoPudieronOcurrir();
  }

  // Los días futuros NO vienen de la API (el plan de AirLabs no publica horarios futuros).
  // Para que el pasajero igual pueda elegir un vuelo de los próximos días, se repite el patrón
  // que ya observamos, marcado ESTIMADO. El día que llega, manda el dato real y la proyección
  // se saltea. Nunca se inventa un vuelo que no hayamos visto antes.
  // MANUAL entra a propósito: hay aerolíneas que vuelan a CPC y no están en AirLabs
  // (American Jet), así que su horario cargado a mano también tiene que proyectarse.
  const observados = await prisma.flight.findMany({
    where: { source: { in: ["API", "ESTIMADO", "MANUAL", "FIDS"] } },
    select: {
      number: true,
      airline: true,
      origin: true,
      destination: true,
      direction: true,
      scheduledAt: true,
      source: true
    }
  });

  // La grilla futura se alineaba al reloj del vuelo de hoy y esas filas quedaron **escritas** en la
  // base (issue #145: JA3182 del 15-nov, 73 minutos antes). Corregir sólo la generación no alcanza,
  // y el bucle de proyección no sirve para esto: se saltea los días que ya tienen datos reales de la
  // API, que son justo los días con la grilla vieja. Se recorre aparte, sólo proyecciones sueltas.
  resumen.realineados += await realinearGrillaFutura(observados);

  for (const dia of diasDesdeHoy(DIAS_PROYECTADOS + 1).slice(1)) {
    const { desde, hasta } = rangoDelDia(dia);
    const realesDelDia = await prisma.flight.count({
      where: { source: "API", scheduledAt: { gte: desde, lt: hasta } }
    });
    if (realesDelDia > 0) continue;

    const proyectadosDelDia = proyectarVuelos(dia, observados);
    for (const proyectado of proyectadosDelDia) {
      const existe = await prisma.flight.findFirst({
        where: { number: proyectado.number, scheduledAt: proyectado.scheduledAt, direction: proyectado.direction }
      });
      if (existe) continue;

      // Mismo número y sentido ese día: ya está cubierto (aunque el horario haya cambiado entre
      // fuentes). Sin esto, un cambio de horario genera una fila duplicada del mismo vuelo.
      const { desde: diaDesde, hasta: diaHasta } = rangoDelDia(dia);
      const mismoVuelo = await prisma.flight.findFirst({
        where: {
          number: proyectado.number,
          direction: proyectado.direction,
          scheduledAt: { gte: diaDesde, lt: diaHasta }
        },
        select: { id: true }
      });
      if (mismoVuelo) continue;

      // Para vuelos sin equivalencia explícita, se conserva la heurística de cercanía horaria —
      // pero sólo contra vuelos de la **misma aerolínea** y que se ofrezcan. Antes comparaba
      // cualquier vuelo del mismo sentido en ±25 minutos: el AJ325 de Neuquén (14:30) bloqueaba
      // el AR1657 del martes 24/11 (14:55), que es otro servicio, otra ruta y otra empresa.
      const gemeloProyectado = jetSmartCanonicalNumber(proyectado.number) ? null : await prisma.flight.findFirst({
        where: {
          direction: proyectado.direction,
          airline: proyectado.airline,
          number: { notIn: [...VUELOS_QUE_NO_SE_OFRECEN] },
          scheduledAt: {
            gte: new Date(proyectado.scheduledAt.getTime() - 25 * 60000),
            lte: new Date(proyectado.scheduledAt.getTime() + 25 * 60000)
          }
        }
      });
      if (gemeloProyectado && esGemeloHorario(proyectado, gemeloProyectado, proyectado.scheduledAt)) continue;

      const { count } = await prisma.flight.createMany({
        skipDuplicates: true,
        data: {
          number: proyectado.number,
          airline: proyectado.airline,
          origin: proyectado.origin,
          destination: proyectado.destination,
          direction: proyectado.direction,
          scheduledAt: proyectado.scheduledAt,
          estimatedAt: null,
          status: proyectado.status,
          externalId: proyectado.externalId,
          source: proyectado.source,
          lastCheckedAt: null
        }
      });
      resumen.proyectados += count;
    }

    resumen.proyectadosLimpiados += await limpiarProyectadosQueYaNoCorresponden(dia, proyectadosDelDia);
  }

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
