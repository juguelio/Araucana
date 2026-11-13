/**
 * Extras del traslado al aeropuerto que se suman a la tarifa por persona:
 * - recargo de zona: monto fijo por reserva cuando el punto cae en el segundo límite del mapa;
 * - equipaje deportivo (esquí, snowboard, bici, tabla): monto por bulto.
 *
 * Los montos son configurables desde el panel (`airport.extras`); la reserva guarda el valor
 * vigente al reservar, así un cambio posterior de precios no altera reservas hechas.
 */
export type AirportExtras = {
  /** Recargo fijo por reserva para la zona con recargo, en centavos. */
  zoneExtraCents: number;
  /** Precio por bulto de equipaje deportivo, en centavos. */
  sportsLuggageCents: number;
  /** Minutos antes del arribo en que se cierran las reservas de un vuelo que llega. */
  arrivalCutoffMinutes: number;
  /**
   * Minutos de gracia antes de que arranque la recorrida de una salida (#55). **0** = se cierra
   * justo cuando arranca: el cliente pidió que, una vez que la combi inició el recorrido, no se
   * pueda reservar más.
   */
  departureCutoffMinutes: number;
};

export const defaultAirportExtras: AirportExtras = { zoneExtraCents: 0, sportsLuggageCents: 0, arrivalCutoffMinutes: 20, departureCutoffMinutes: 0 };

export const MAX_SPORTS_LUGGAGE = 24;

export type AirportExtrasBreakdown = {
  zoneExtraCents: number;
  sportsLuggageCount: number;
  sportsLuggageUnitCents: number;
  sportsLuggageTotalCents: number;
  totalCents: number;
};

export function airportExtrasBreakdown(
  input: { zoneExtra: boolean; sportsLuggageCount?: number },
  extras: Pick<AirportExtras, "zoneExtraCents" | "sportsLuggageCents">
): AirportExtrasBreakdown {
  const count = Math.min(Math.max(Math.trunc(input.sportsLuggageCount ?? 0) || 0, 0), MAX_SPORTS_LUGGAGE);
  const zoneExtraCents = input.zoneExtra ? extras.zoneExtraCents : 0;
  const sportsLuggageTotalCents = count * extras.sportsLuggageCents;
  return {
    zoneExtraCents,
    sportsLuggageCount: count,
    sportsLuggageUnitCents: extras.sportsLuggageCents,
    sportsLuggageTotalCents,
    totalCents: zoneExtraCents + sportsLuggageTotalCents
  };
}
