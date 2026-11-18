/**
 * Varios vuelos en una sola hoja del chofer: en Aeropuerto se marcan los vuelos y «Hoja del chofer»
 * abre la orden de servicio con todos juntos (`flights=a,b,c`), lista para imprimir en las menos
 * hojas posibles.
 */
export const MAX_VUELOS_POR_HOJA = 50;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Lee `flights=a,b,c` de la URL: sólo ids válidos, sin repetir y con tope. */
export function vuelosDeLaHoja(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((id) => id.trim()).filter((id) => ID.test(id)))].slice(0, MAX_VUELOS_POR_HOJA);
}

/** La hoja del chofer de uno o varios vuelos del día. Con más de uno, la hoja se abre para imprimir. */
export function hojaDelChoferHref(date: string, flightIds: string[]) {
  const query = new URLSearchParams({ date });
  if (flightIds.length === 1) query.set("flight", flightIds[0]);
  else if (flightIds.length > 1) {
    query.set("flights", flightIds.join(","));
    query.set("imprimir", "1");
  }
  return `/admin/aeropuerto/orden-de-servicio/ver?${query.toString()}`;
}
