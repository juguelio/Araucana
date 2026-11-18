/**
 * Volver a la orden de servicio después de asignar nave y chofer desde su modal. El formulario manda
 * la query de la orden (`date`, y opcionalmente `flight` y `vehicle`); se rearma sólo con esas
 * claves validadas, así un valor armado a mano no puede redirigir a otro lado.
 */
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
  const flight = params.get("flight");
  if (flight && ID.test(flight)) {
    query.set("flight", flight);
    const vehicle = params.get("vehicle");
    if (vehicle && ID.test(vehicle)) query.set("vehicle", vehicle);
  }
  query.set("notice", notice);
  return `/admin/aeropuerto/orden-de-servicio/ver?${query.toString()}`;
}
