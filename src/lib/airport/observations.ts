import { extremoDelVuelo } from "./airports";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { airportLocalDay } from "./data-quality";
import type { FidsFlight } from "./fids";
import { asociarLectura, discrepancia, numeroCanonico, type FilaCandidata } from "./observation-match";

/**
 * Registro por fuente de cada lectura del sync (modo sombra).
 *
 * Guarda lo que dijo AirLabs y lo que dijo el tablero, tal como vino, qué hizo el sync con cada
 * lectura y qué fila habría elegido el asociador por identidad de vuelo. No cambia nada de
 * `Flight`: sirve para medir duplicados y diferencias entre fuentes antes de que el asociador
 * decida. Nunca rompe el sync: si no se puede guardar, se avisa en el log y se sigue.
 */

export type ResultadoDelSync =
  | "PENDIENTE_DE_CONFIRMACION"
  | "FECHA_FUTURA_INFERIDA"
  | "PENDIENTE"
  | "CREADO"
  | "ACTUALIZADO"
  | "ESTADO_SOBRE_API"
  | "DESCARTADO_GEMELO"
  | "DESCARTADO_CODIGO_COMPARTIDO"
  | "DESCARTADO_DUPLICADO_PROVEEDOR"
  | "REPETIDO_EN_TABLERO"
  | "SIN_FECHA";

export type ObservacionPendiente = {
  source: "API" | "FIDS";
  direction: string;
  rawNumber: string;
  codeshareOf: string | null;
  airline: string | null;
  origin: string | null;
  scheduledAt: Date | null;
  estimatedAt: Date | null;
  status: string | null;
  rawStatus: string | null;
  localDay: string | null;
  dayInferred: boolean;
  payload: Prisma.InputJsonValue | null;
  outcome: ResultadoDelSync;
  flightId: string | null;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const desdeTs = (v: unknown) => (num(v) ? new Date(num(v)! * 1000) : null);

/** Campos de AirLabs que se conservan: los operativos. La respuesta no trae la clave, pero se filtra igual. */
const CAMPOS_AIRLABS = [
  "airline_iata", "airline_icao", "flight_iata", "flight_icao", "flight_number",
  "cs_airline_iata", "cs_flight_iata", "cs_flight_number",
  "dep_iata", "arr_iata", "dep_time", "arr_time", "dep_estimated", "arr_estimated",
  "dep_delayed", "arr_delayed", "status", "duration"
] as const;

export function observacionDeAirLabs(item: Record<string, unknown>, direction: string): ObservacionPendiente | null {
  const rawNumber = str(item.flight_iata);
  if (!rawNumber) return null;
  const llegada = direction === "ARRIVAL";
  const scheduledAt = desdeTs(llegada ? item.arr_time_ts : item.dep_time_ts);
  const payload: Record<string, string | number> = {};
  for (const campo of CAMPOS_AIRLABS) {
    const valor = item[campo];
    if (typeof valor === "string" || typeof valor === "number") payload[campo] = valor;
  }
  return {
    source: "API",
    direction,
    rawNumber,
    codeshareOf: str(item.cs_flight_iata),
    airline: str(item.airline_iata) ?? str(item.airline_icao),
    origin: str(llegada ? item.dep_iata : item.arr_iata),
    scheduledAt,
    estimatedAt: desdeTs(llegada ? item.arr_estimated_ts : item.dep_estimated_ts),
    status: null,
    rawStatus: str(item.status),
    localDay: scheduledAt ? airportLocalDay(scheduledAt) : null,
    dayInferred: false,
    payload,
    outcome: "PENDIENTE",
    flightId: null
  };
}

/** El tablero no trae fecha: el día lo infiere el sync y se marca como inferido. */
export function observacionDelTablero(f: FidsFlight, direction: string): ObservacionPendiente {
  return {
    source: "FIDS",
    direction,
    rawNumber: f.number,
    codeshareOf: null,
    airline: f.airlineCode || null,
    origin: f.city || null,
    scheduledAt: null,
    estimatedAt: null,
    status: null,
    rawStatus: f.statusText || null,
    localDay: null,
    dayInferred: true,
    payload: {
      scheduled: f.scheduled,
      estimated: f.estimated,
      statusText: f.statusText,
      statusClass: f.statusClass,
      airlineName: f.airlineName ?? null
    },
    outcome: "PENDIENTE",
    flightId: null
  };
}

export type ResumenDeObservaciones = { registradas: number; discrepancias: number };

/**
 * Asocia cada lectura contra la grilla tal como quedó después del sync y guarda todo junto.
 * Las filas creadas por el sync no tienen id en el momento (se crean con `createMany`): se
 * resuelven acá por número, horario y sentido, que es la clave única de `Flight`.
 */
export async function guardarObservaciones(
  syncRunId: string,
  lecturas: readonly ObservacionPendiente[]
): Promise<ResumenDeObservaciones> {
  if (lecturas.length === 0) return { registradas: 0, discrepancias: 0 };
  try {
    const dias = [...new Set(lecturas.map((l) => l.localDay ?? (l.scheduledAt ? airportLocalDay(l.scheduledAt) : null)).filter(Boolean))] as string[];
    let filas: FilaCandidata[] = [];
    if (dias.length > 0) {
      const ordenados = [...dias].sort();
      const desde = new Date(`${ordenados[0]}T00:00:00-03:00`);
      const hasta = new Date(new Date(`${ordenados[ordenados.length - 1]}T00:00:00-03:00`).getTime() + 86400000);
      filas = (await prisma.flight.findMany({
        where: { scheduledAt: { gte: desde, lt: hasta } },
        select: { id: true, number: true, airline: true, origin: true, destination: true, direction: true, scheduledAt: true }
      }) ?? []).map(f => ({ ...f, origin: extremoDelVuelo(f) }));
    }

    // Una fila que el sync aplicó y después borró en la misma corrida (unificación, limpieza de
    // proyecciones) rompería la FK de todo el lote: esa referencia se guarda vacía.
    const referidas = [...new Set(lecturas.map((l) => l.flightId).filter(Boolean))] as string[];
    const vigentes = new Set(filas.map((f) => f.id));
    const faltantes = referidas.filter((id) => !vigentes.has(id));
    if (faltantes.length > 0) {
      const existen = (await prisma.flight.findMany({ where: { id: { in: faltantes } }, select: { id: true } })) ?? [];
      for (const { id } of existen) vigentes.add(id);
    }

    let discrepancias = 0;
    const data: Prisma.FlightObservationCreateManyInput[] = lecturas.map((l) => {
      let flightId = l.flightId && vigentes.has(l.flightId) ? l.flightId : null;
      if (!flightId && l.outcome === "CREADO" && l.scheduledAt) {
        const numero = numeroCanonico(l.rawNumber);
        flightId =
          filas.find(
            (f) => f.direction === l.direction && numeroCanonico(f.number) === numero && f.scheduledAt.getTime() === l.scheduledAt!.getTime()
          )?.id ?? null;
      }
      const asociacion = asociarLectura(l, filas);
      const diferencia = discrepancia({ outcome: l.outcome, flightId }, asociacion);
      if (diferencia) discrepancias += 1;
      return {
        syncRunId,
        source: l.source,
        direction: l.direction,
        rawNumber: l.rawNumber,
        canonicalNumber: asociacion.canonicalNumber,
        airline: l.airline,
        codeshareOf: l.codeshareOf,
        origin: l.origin,
        scheduledAt: l.scheduledAt,
        estimatedAt: l.estimatedAt,
        status: l.status,
        rawStatus: l.rawStatus,
        localDay: l.localDay ?? (l.scheduledAt ? airportLocalDay(l.scheduledAt) : null),
        dayInferred: l.dayInferred,
        matchKey: asociacion.clave,
        syncOutcome: l.outcome,
        flightId,
        matcherFlightId: asociacion.flightId,
        matchLevel: asociacion.nivel,
        discrepancy: diferencia,
        ...(l.payload !== null ? { payload: l.payload } : {})
      };
    });

    const { count } = await prisma.flightObservation.createMany({ data });
    return { registradas: count, discrepancias };
  } catch (error) {
    console.warn("[aeropuerto] no se pudieron guardar las observaciones del sync", error instanceof Error ? error.message : error);
    return { registradas: 0, discrepancias: 0 };
  }
}
