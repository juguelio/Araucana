import { fareCounts, reservationTotalCents } from "@/lib/booking/passenger-fares";
import { airportExtrasBreakdown, type AirportExtras } from "./extras";
import { chargesZoneExtra, type AirportCoverage, type PickupPoint } from "./pickup-zone";

type Direction = "ARRIVAL" | "DEPARTURE";

/** El mismo horario vigente que se usa para cerrar reservas cuando hay demoras. */
export function effectiveFlightTime(flight: { scheduledAt: Date | string; estimatedAt?: Date | string | null }) {
  return Math.max(new Date(flight.scheduledAt).getTime(), flight.estimatedAt ? new Date(flight.estimatedAt).getTime() : 0);
}

export function roundTripOrderValid(arrival: Parameters<typeof effectiveFlightTime>[0], departure: Parameters<typeof effectiveFlightTime>[0], firstLeg: Direction) {
  const difference = effectiveFlightTime(departure) - effectiveFlightTime(arrival);
  return firstLeg === "ARRIVAL" ? difference > 0 : difference < 0;
}

export function orderedRoundTrip<T>(arrival: T, departure: T, firstLeg: Direction) {
  return firstLeg === "ARRIVAL"
    ? [{ label: "Ida · Llegada", value: arrival }, { label: "Vuelta · Salida", value: departure }]
    : [{ label: "Ida · Salida", value: departure }, { label: "Vuelta · Llegada", value: arrival }];
}

/** Cotización por tramo: incluye zona y equipaje; nunca suma monedas distintas. */
export function roundTripQuote(input: {
  arrival: { priceCents: number; currency: string; point: PickupPoint | null };
  departure: { priceCents: number; currency: string; point: PickupPoint | null };
  passengerCount: number;
  halfFareCount: number;
  freeFareCount: number;
  sportsLuggageCount: number;
  coverage: AirportCoverage;
  extras: Pick<AirportExtras, "sportsLuggageCents" | "zoneExtraCents">;
}) {
  const quote = (fare: typeof input.arrival) => {
    const extras = airportExtrasBreakdown({ zoneExtra: chargesZoneExtra(fare.point, input.coverage), sportsLuggageCount: input.sportsLuggageCount }, input.extras);
    return { currency: fare.currency, extras, totalCents: reservationTotalCents(fare.priceCents, fareCounts(input.passengerCount, input.halfFareCount, input.freeFareCount)) + extras.totalCents };
  };
  const arrival = quote(input.arrival);
  const departure = quote(input.departure);
  const totals = new Map<string, number>();
  for (const leg of [arrival, departure]) totals.set(leg.currency, (totals.get(leg.currency) ?? 0) + leg.totalCents);
  return { arrival, departure, totals: [...totals].map(([currency, amountCents]) => ({ currency, amountCents })) };
}
