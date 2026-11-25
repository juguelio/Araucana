import { crearTokenDeOrden, leerTokenDeOrden, vencimientoDelLink } from "@/lib/airport/service-order-link";
import { claveDe, ultimoDia } from "./rango";

const purpose = "orden-viaje-especial";

export function specialTripOrderPath(trip: { id: string; serviceDate: Date; endDate: Date | null }, now = new Date()) {
  const date = claveDe(ultimoDia(trip));
  const exp = vencimientoDelLink(date);
  if (exp <= now.getTime() / 1000) return null;
  const token = crearTokenDeOrden({ date, flight: trip.id, exp }, purpose);
  return `/orden/viaje-especial/${token}`;
}

export function readSpecialTripOrderLink(token: string, now = new Date()) {
  const payload = leerTokenDeOrden(token, now, purpose);
  return payload?.flight ? { tripId: payload.flight, lastDay: payload.date } : null;
}
