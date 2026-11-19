/**
 * Volver a la orden de servicio después de asignar nave y chofer desde su modal. El formulario manda
 * la query de la orden (`date`, y opcionalmente `flight` y `vehicle`); se rearma sólo con esas
 * claves validadas, así un valor armado a mano no puede redirigir a otro lado.
 */
import { claveDeOrden, ordenesDeLaHoja, vuelosDeLaHoja } from "@/lib/airport/flight-selection";

export const ORDER_RETURN_FIELD = "volverAOrden";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function orderReturnHref(formData: FormData, notice: string): string | null {
  const raw = formData.get(ORDER_RETURN_FIELD);
  if (typeof raw !== "string" || !raw) return null;
  const params = new URLSearchParams(raw);
  const date = params.get("date") ?? "";
  if (!DATE.test(date)) return null;
  const query = new URLSearchParams({ date });
  for (const key of ["vehicleId", "driverId"]) {
    const resourceId = params.get(key);
    if (resourceId === null) continue;
    if (!ID.test(resourceId)) return null;
    query.set(key, resourceId);
  }
  const flight = params.get("flight");
  if (flight && ID.test(flight)) {
    query.set("flight", flight);
    const vehicle = params.get("vehicle");
    if (vehicle && ID.test(vehicle)) query.set("vehicle", vehicle);
  }
  const flights = vuelosDeLaHoja(params.get("flights"));
  if (!flight && flights.length) query.set("flights", flights.join(","));
  const ordenes = ordenesDeLaHoja(params.get("ordenes"));
  if (!flight && ordenes.length) query.set("ordenes", ordenes.map(claveDeOrden).join(","));
  query.set("notice", notice);
  return `/admin/aeropuerto/orden-de-servicio/ver?${query.toString()}`;
}

/**
 * Paso «Naves y choferes» de coordinar una recorrida: el modal de combis del vuelo queda abierto mientras
 * se suman, quitan o cambian naves (`naves=<vuelo>` en la URL del tablero). El formulario manda el id del
 * vuelo; se valida para que no pueda armar otra URL.
 */
export const NAVES_STEP_FIELD = "pasoNaves";

export function navesStepHref(formData: FormData, date: string, notice: string): string | null {
  const raw = formData.get(NAVES_STEP_FIELD);
  if (typeof raw !== "string" || !ID.test(raw) || !DATE.test(date)) return null;
  return `/admin/aeropuerto?${new URLSearchParams({ date, notice, naves: raw })}`;
}
