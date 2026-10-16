/**
 * Conector con AirLabs para los vuelos de CPC (Aeropuerto Chapelco / SAZY).
 *
 * El aeropuerto no define salidas propias: sus "salidas" son los vuelos. Por eso el sistema
 * cachea los vuelos en la tabla `Flight` y el front y el panel leen de ahí (no pegan a la API
 * en cada visita). Parte pura: `normalizeSchedules` no toca red ni base, así se testea.
 */

export type FlightDirection = "ARRIVAL" | "DEPARTURE";

export type NormalizedFlight = {
  number: string;
  airline: string | null;
  origin: string;
  destination: string;
  direction: FlightDirection;
  scheduledAt: Date;
  estimatedAt: Date | null;
  status: "SCHEDULED" | "DELAYED" | "EN_ROUTE" | "CANCELLED" | "DIVERTED" | "LANDED";
  externalId: string;
};

export const CPC = "Aeropuerto Chapelco (CPC)";
export const UMBRAL_DEMORA_API_MIN = 30;

/** Estado de AirLabs → estado nuestro. `active` = en vuelo: cuenta como programado salvo demora. */
export function mapStatus(rawStatus: string | undefined, delayMin: number | null): NormalizedFlight["status"] {
  const s = (rawStatus || "").toLowerCase();
  if (s === "cancelled" || s === "canceled") return "CANCELLED";
  if (s === "diverted") return "DIVERTED";
  if (s === "landed" || s === "arrived") return "LANDED";
  // AirLabs usa "active" para el avión en vuelo: es información útil, no la colapsamos.
  if (s === "active" || s === "en-route" || s === "enroute") return "EN_ROUTE";
  if (delayMin !== null && delayMin >= UMBRAL_DEMORA_API_MIN) return "DELAYED";
  return "SCHEDULED";
}

type RawSchedule = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fecha = (ts: unknown) => (num(ts) ? new Date(num(ts)! * 1000) : null);

/**
 * Normaliza la respuesta de `schedules` de AirLabs.
 * Ojo: la API devuelve el mismo vuelo físico repetido por código compartido (JA3183 y WJ3183):
 * se deduplica por (origen, horario programado) y se prefiere la fila sin código compartido.
 */
export function normalizeSchedules(items: RawSchedule[], direction: FlightDirection): NormalizedFlight[] {
  const out = new Map<string, NormalizedFlight>();

  for (const it of items) {
    const number = str(it.flight_iata);
    const scheduledAt = fecha(direction === "ARRIVAL" ? it.arr_time_ts : it.dep_time_ts);
    if (!number || !scheduledAt) continue;

    const delayMin = num(direction === "ARRIVAL" ? it.arr_delayed : it.dep_delayed);
    const estimatedAt = fecha(direction === "ARRIVAL" ? it.arr_estimated_ts : it.dep_estimated_ts);
    const origin = str(direction === "ARRIVAL" ? it.dep_iata : it.arr_iata) ?? "—";

    const vuelo: NormalizedFlight = {
      number,
      airline: str(it.airline_iata),
      origin,
      destination: direction === "ARRIVAL" ? CPC : origin,
      direction,
      scheduledAt,
      estimatedAt,
      status: mapStatus(str(it.status) ?? undefined, delayMin),
      externalId: `${number}@${scheduledAt.toISOString()}`
    };

    const clave = `${direction}|${origin}|${scheduledAt.toISOString()}`;
    const previo = out.get(clave);
    const esCodeshare = Boolean(str(it.cs_flight_iata));
    if (!previo || (esCodeshare === false && previo.number !== number)) {
      out.set(clave, vuelo);
    }
  }

  return [...out.values()].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

/** Trae los vuelos de un día desde AirLabs. Sin clave o con error devuelve [] (modo degradado). */
export async function fetchSchedules(direction: FlightDirection, dia: string): Promise<{ flights: NormalizedFlight[]; error: string | null }> {
  const key = process.env.AIRLABS_API_KEY;
  if (!key) return { flights: [], error: "Falta AIRLABS_API_KEY" };

  const param = direction === "ARRIVAL" ? "arr_iata" : "dep_iata";
  const url = `https://airlabs.co/api/v9/schedules?${param}=CPC&date=${dia}&api_key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { flights: [], error: `AirLabs HTTP ${res.status}` };
    const data = (await res.json()) as { response?: RawSchedule[]; error?: { message?: string } };
    if (data.error) return { flights: [], error: data.error.message ?? "error de AirLabs" };
    const items = (data.response ?? []).filter((it) => {
      const ts = fecha(direction === "ARRIVAL" ? it.arr_time_ts : it.dep_time_ts);
      return ts ? ts.toISOString().slice(0, 10) === dia : false;
    });
    return { flights: normalizeSchedules(items, direction), error: null };
  } catch (e) {
    return { flights: [], error: e instanceof Error ? e.message : "error de red" };
  }
}
