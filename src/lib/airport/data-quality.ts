/** Señales de trazabilidad; una consulta reciente no prueba que una fecha inferida sea correcta. */
export type FlightEvidence = {
  source?: string;
  status: string;
  direction?: string;
  scheduledAt: Date;
  estimatedAt: Date | null;
  actualAt?: Date | null;
  lastCheckedAt?: Date | null;
};

export function airportLocalDay(date: Date) {
  return new Date(date.getTime() - 3 * 3600000).toISOString().slice(0, 10);
}

/** En FIDS 00:00 es una estima sin informar. No usarla como llegada a medianoche. */
export function reliableEstimate(flight: FlightEvidence): Date | null {
  if (flight.source === "FIDS" && flight.estimatedAt &&
    new Date(flight.estimatedAt.getTime() - 3 * 3600000).toISOString().slice(11, 16) === "00:00") return null;
  return flight.estimatedAt;
}

export function flightEvidenceWarning(flight: FlightEvidence, now: Date): string | null {
  if (flight.source === "FIDS") {
    if (!flight.lastCheckedAt || airportLocalDay(flight.lastCheckedAt) < airportLocalDay(flight.scheduledAt)) {
      return "Fecha sin confirmar: este tablero sin fecha se leyó antes del día asignado al vuelo.";
    }
    const reference = reliableEstimate(flight) ?? flight.scheduledAt;
    const observedAt = flight.lastCheckedAt < now ? flight.lastCheckedAt : now;
    if (flight.status === "LANDED" && reference > observedAt && !(flight.actualAt && flight.actualAt <= observedAt)) {
      return "Estado incompatible con el horario: verificar aterrizaje con la fuente.";
    }
  }
  return null;
}

export function flightSourceLabel(source?: string) {
  if (source === "API") return "AirLabs · horario con fecha";
  if (source === "FIDS") return "Tablero del aeropuerto · fecha inferida";
  if (source === "MANUAL") return "Carga manual · sin seguimiento automático garantizado";
  if (source === "ESTIMADO") return "Proyección histórica · no confirmada por la aerolínea";
  if (source === "PASAJERO") return "Cargado por el pasajero · verificar";
  return "Fuente sin identificar";
}
