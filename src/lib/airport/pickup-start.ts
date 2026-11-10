const TWO_HOURS = 2 * 60 * 60 * 1000;

export const AIRPORT_PICKUP_COPY =
  "Tené todo listo en la dirección indicada desde esa hora. La camioneta busca a los pasajeros uno por uno y puede pasar más tarde, según el orden de la recorrida.";

export function airportPickupStart(flight: {
  direction: string;
  scheduledAt: Date;
  pickupStartOverrideAt?: Date | null;
  status?: string;
}) {
  if (flight.direction !== "DEPARTURE" || flight.status === "CANCELLED" || flight.status === "DIVERTED") return null;
  return flight.pickupStartOverrideAt ?? new Date(flight.scheduledAt.getTime() - TWO_HOURS);
}

export const airportPickupDateTime = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Salta"
});
