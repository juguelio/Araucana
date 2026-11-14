import { detectFlightChange, jetSmartCanonicalNumber } from "@/lib/airport/flights";
import { planificarUnificacionJetSmart } from "@/lib/airport/dedupe";
import { deleteUnoccupiedFlight } from "@/lib/airport/flight-cleanup";
import { unificarFilasDeVuelo } from "@/lib/airport/flight-merge";
import { DIAS_PROYECTADOS, fechaLocal, proyectarVuelos } from "@/lib/airport/projection";
import { estadoSegunHorario, fechaDelTablero, fetchFidsBoard, mapFidsStatus } from "@/lib/airport/fids";
import { fetchSchedules, type FlightDirection } from "@/lib/airport/provider";
import { prisma } from "@/lib/db/prisma";
import { getAirLabsKey } from "@/lib/settings/app-settings";

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

export async function syncAirportFlights(opts: { days?: number } = {}): Promise<SyncSummary> {
  const resumen: SyncSummary = { corridas: 0, creados: 0, actualizados: 0, eventos: 0, proyectados: 0, desdeTablero: 0, limpiados: 0, proyectadosLimpiados: 0, jetSmartUnificados: 0, repetidosConReservas: [], errores: [] };
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
      const fecha = fechaDelTablero(f.scheduled);
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
      const estado = estadoSegunHorario(mapFidsStatus(f), scheduledAt, estimatedAt);

      // Mismo número y día observado: buscar la fila existente antes de usar este dato sin fecha.
      const desdeElDia = new Date(`${fecha}T00:00:00-03:00`);
      const hastaElDia = new Date(desdeElDia.getTime() + 86400000);
      const candidatos = await prisma.flight.findMany({
        where: { number, direction, scheduledAt: { gte: desdeElDia, lt: hastaElDia } },
        include: { _count: { select: { reservations: true, assignments: true } } }
      });

      // El tablero no tiene fecha de vuelo: complementa, no reemplaza la API con fecha
      // consultada en esta misma jornada. Evita mezclar estado/horario de fuentes distintas.
      if (candidatos.some((v) => v.source === "API" && v.lastCheckedAt && fechaLocal(v.lastCheckedAt) === fecha)) continue;

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

        // No propagar una fila sin fecha a los horarios de todo el mes.

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

  for (const dia of diasDesdeHoy(DIAS_PROYECTADOS + 1).slice(1)) {
    const { desde, hasta } = rangoDelDia(dia);
    const realesDelDia = await prisma.flight.count({
      where: { source: "API", scheduledAt: { gte: desde, lt: hasta } }
    });
    if (realesDelDia > 0) continue;

    for (const proyectado of proyectarVuelos(dia, observados)) {
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
        }
      });
      if (mismoVuelo) continue;

      // Para vuelos sin equivalencia explícita, se conserva la heurística de cercanía horaria.
      const gemeloProyectado = jetSmartCanonicalNumber(proyectado.number) ? null : await prisma.flight.findFirst({
        where: {
          direction: proyectado.direction,
          scheduledAt: {
            gte: new Date(proyectado.scheduledAt.getTime() - 25 * 60000),
            lte: new Date(proyectado.scheduledAt.getTime() + 25 * 60000)
          }
        }
      });
      if (gemeloProyectado) continue;

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
  }

  return resumen;
}
