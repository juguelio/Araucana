import { listAirportFlights } from "./booking";
import { asegurarVuelosRealesDelDia } from "./freshness";

export async function loadAirportCheckoutFlights(date: string) {
  // Refresh stale flight data before computing availability for the day of travel.
  await asegurarVuelosRealesDelDia(date);
  const flights = await listAirportFlights({ date });

  return flights.map((flight) => ({
    ...flight,
    scheduledAt: flight.scheduledAt.toISOString(),
    estimatedAt: flight.estimatedAt?.toISOString() ?? null,
    pickupStartAt: flight.pickupStartAt?.toISOString() ?? null
  }));
}
