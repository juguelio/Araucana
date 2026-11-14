/**
 * Cuánto antes del vuelo arranca la recorrida que pasa a buscar a los pasajeros por sus domicilios.
 *
 * Son 2 h 30 por pedido del cliente (11-nov, issue #35): antes eran 2 h exactas y el margen no
 * alcanzaba para juntar a todos los pasajeros y llegar con tiempo al check-in. El operador puede
 * adelantarla o retrasarla por vuelo desde el panel (`pickupStartOverrideAt`).
 */
export const AIRPORT_PICKUP_LEAD_MINUTES = 150;

const LEAD_MS = AIRPORT_PICKUP_LEAD_MINUTES * 60 * 1000;

export const AIRPORT_PICKUP_COPY =
  "Tené todo listo en la dirección indicada desde esa hora. La camioneta busca a los pasajeros uno por uno y puede pasar más tarde, según el orden de la recorrida.";

export function airportPickupStart(flight: {
  direction: string;
  scheduledAt: Date;
  estimatedAt?: Date | null;
  pickupStartOverrideAt?: Date | null;
  status?: string;
}) {
  if (flight.direction !== "DEPARTURE" || flight.status === "CANCELLED" || flight.status === "DIVERTED") return null;
  const reference = flight.estimatedAt && flight.estimatedAt > flight.scheduledAt ? flight.estimatedAt : flight.scheduledAt;
  return flight.pickupStartOverrideAt ?? new Date(reference.getTime() - LEAD_MS);
}

export const airportPickupDateTime = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Salta"
});
