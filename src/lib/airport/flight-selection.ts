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

/**
 * Una orden puntual de la hoja: la de un vuelo (o una recorrida unida) y, si sale con varias combis, la
 * de una combi (`vehicle` = la referencia de `referenciaDeLaOrden`). En la URL va como `vuelo~nave`
 * (`vuelo~` cuando el vuelo sale con una sola), separadas por coma: `ordenes=a~x,b~`.
 */
export type OrdenElegida = { flight: string; vehicle: string | null };

const ORDEN = /^([A-Za-z0-9_-]{1,64})~([A-Za-z0-9_-]{0,64})$/;

export const claveDeOrden = ({ flight, vehicle }: OrdenElegida) => `${flight}~${vehicle ?? ""}`;

/** Lee `ordenes=a~x,b~` de la URL: sólo pares válidos, sin repetir y con tope. */
export function ordenesDeLaHoja(raw: string | null | undefined): OrdenElegida[] {
  if (!raw) return [];
  const vistas = new Set<string>();
  const ordenes: OrdenElegida[] = [];
  for (const parte of raw.split(",")) {
    const match = ORDEN.exec(parte.trim());
    if (!match || vistas.has(match[0])) continue;
    vistas.add(match[0]);
    ordenes.push({ flight: match[1], vehicle: match[2] || null });
  }
  return ordenes.slice(0, MAX_VUELOS_POR_HOJA);
}

/**
 * La hoja del chofer de las órdenes elegidas: una sola abre esa orden (la de su combi, si la recorrida
 * sale con varias); varias se abren juntas, listas para imprimir.
 */
export function hojaDeOrdenesHref(date: string, ordenes: OrdenElegida[]) {
  if (ordenes.length === 1) {
    const query = new URLSearchParams({ date, flight: ordenes[0].flight });
    if (ordenes[0].vehicle) query.set("vehicle", ordenes[0].vehicle);
    return `/admin/aeropuerto/orden-de-servicio/ver?${query.toString()}`;
  }
  const query = new URLSearchParams({ date });
  if (ordenes.length > 1) {
    query.set("ordenes", ordenes.map(claveDeOrden).join(","));
    query.set("imprimir", "1");
  }
  return `/admin/aeropuerto/orden-de-servicio/ver?${query.toString()}`;
}
