/**
 * Piezas compartidas por los dos endpoints de reserva del aeropuerto (tramo único e ida y vuelta):
 * el mapa de errores del dominio a HTTP y el chequeo de cobertura del pickup.
 */
import { jsonError } from "@/lib/api/responses";
import { isInsideAirportPickupZone, OUTSIDE_PICKUP_ZONE, type AirportCoverage } from "./pickup-zone";

export const AIRPORT_ERROR_RESPONSES: Record<string, { message: string; status: number }> = {
  ROUTE_NOT_FOUND: { message: "La ruta no está disponible para reservar.", status: 404 },
  FLIGHT_NOT_FOUND: { message: "No encontramos ese vuelo para esa fecha. Revisá el número de vuelo.", status: 404 },
  FLIGHT_IN_PAST: { message: "El horario del vuelo ya pasó. Revisá la hora e intentá de nuevo.", status: 400 },
  PRIVATE_FLIGHT_INVALID: { message: "Revisá el vuelo privado: tiene que ser del mismo día de la reserva y con un horario válido.", status: 400 },
  CAPACITY_FULL: { message: "No quedan lugares en ese vuelo. Probá con otro vuelo del día.", status: 409 },
  SCHEDULE_CLOSED: { message: "Ese vuelo ya no está disponible para reservar.", status: 409 },
  BOOKING_BUSY: { message: "Ese vuelo está recibiendo otras reservas. Intentá nuevamente.", status: 409 },
  CODE_COLLISION: { message: "No pudimos generar la reserva. Intentá nuevamente.", status: 503 }
};

/** ¿El pickup de este tramo es válido para la cobertura configurada? Devuelve la respuesta de error o null. */
export function pickupCoverageError(
  tramo: { pickupAddress?: string; pickupPoint?: [number, number] },
  coverage: AirportCoverage,
  tramoNombre: string
) {
  if (!tramo.pickupPoint && (coverage.enabled || tramo.pickupAddress?.trim())) {
    return jsonError("PICKUP_POINT_REQUIRED", `Confirmá el punto del traslado en el mapa (${tramoNombre}).`, 400);
  }
  if (coverage.enabled && tramo.pickupPoint && !isInsideAirportPickupZone(tramo.pickupPoint, coverage)) {
    return jsonError("OUTSIDE_PICKUP_ZONE", OUTSIDE_PICKUP_ZONE, 422);
  }
  return null;
}
