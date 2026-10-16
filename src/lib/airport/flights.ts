/**
 * Vuelos del aeropuerto (CPC / SAZY). Parte pura y testeable: no toca base ni red.
 *
 * El valor del módulo no es "ver el vuelo": es que el sistema detecte el imprevisto
 * (demora, cancelación, desvío) y avise a tiempo para no mandar la combi al pedo ni dejar
 * al pasajero varado. Por eso la pieza central es `detectFlightChange`.
 */

export type FlightStatus = "SCHEDULED" | "DELAYED" | "CANCELLED" | "DIVERTED" | "LANDED";
export type FlightDirection = "ARRIVAL" | "DEPARTURE";

export const FLIGHT_STATUSES: Array<{ code: FlightStatus; label: string }> = [
  { code: "SCHEDULED", label: "Programado" },
  { code: "DELAYED", label: "Demorado" },
  { code: "CANCELLED", label: "Cancelado" },
  { code: "DIVERTED", label: "Desviado" },
  { code: "LANDED", label: "Aterrizó" }
];

export function statusLabel(code: string): string {
  return FLIGHT_STATUSES.find((s) => s.code === code)?.label ?? code;
}

export const UMBRAL_DEMORA_MIN = 30;
export const UMBRAL_ADELANTO_MIN = 15;

export type FlightSnapshot = {
  status: string;
  scheduledAt: Date;
  estimatedAt: Date | null;
};

export type FlightChange = {
  kind: "CANCEL" | "DIVERSION" | "DELAY" | "EARLY";
  fromValue: string | null;
  toValue: string | null;
};

// Horas en hora local argentina (-03), que es la que lee la operación.
const TZ_OFFSET_MIN = -180;
const hhmm = (d: Date) => new Date(d.getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(11, 16);

/** Minutos de corrimiento contra el horario programado (positivo = más tarde). */
export function shiftMinutes(snapshot: FlightSnapshot): number {
  const ref = snapshot.estimatedAt ?? snapshot.scheduledAt;
  return Math.round((ref.getTime() - snapshot.scheduledAt.getTime()) / 60000);
}

/**
 * Compara el estado anterior con el nuevo y devuelve el imprevisto, o null si no cambió nada
 * que amerite aviso. Es la función que decide si suena la alarma.
 */
export function detectFlightChange(
  prev: FlightSnapshot,
  next: FlightSnapshot,
  umbralDemora = UMBRAL_DEMORA_MIN,
  umbralAdelanto = UMBRAL_ADELANTO_MIN
): FlightChange | null {
  if (prev.status !== next.status) {
    if (next.status === "CANCELLED") return { kind: "CANCEL", fromValue: prev.status, toValue: next.status };
    if (next.status === "DIVERTED") return { kind: "DIVERSION", fromValue: prev.status, toValue: next.status };
  }

  const antes = shiftMinutes(prev);
  const ahora = shiftMinutes(next);
  if (ahora >= umbralDemora && ahora > antes) {
    return { kind: "DELAY", fromValue: hhmm(prev.estimatedAt ?? prev.scheduledAt), toValue: hhmm(next.estimatedAt ?? next.scheduledAt) };
  }
  if (ahora <= -umbralAdelanto && ahora < antes) {
    return { kind: "EARLY", fromValue: hhmm(prev.estimatedAt ?? prev.scheduledAt), toValue: hhmm(next.estimatedAt ?? next.scheduledAt) };
  }
  return null;
}

/** Texto corto para el panel: "Demorado 45 min" / "Cancelado". */
export function statusDetail(flight: FlightSnapshot): string {
  if (flight.status === "CANCELLED") return "Cancelado";
  if (flight.status === "DIVERTED") return "Desviado";
  if (flight.status === "LANDED") return "Aterrizó";
  const min = shiftMinutes(flight);
  if (min >= UMBRAL_DEMORA_MIN) return `Demorado ${min} min`;
  if (min <= -UMBRAL_ADELANTO_MIN) return `Adelantado ${Math.abs(min)} min`;
  return "En horario";
}

/** ¿Este vuelo tiene un imprevisto que hay que mirar? */
export function needsAttention(flight: FlightSnapshot): boolean {
  return shiftMinutes(flight) >= UMBRAL_DEMORA_MIN || ["CANCELLED", "DIVERTED"].includes(flight.status);
}
