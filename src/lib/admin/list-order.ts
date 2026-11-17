/**
 * Orden por columna de los listados del panel (issue #192).
 *
 * El cliente pidió «filtrar, paginar y ordenar por las distintas columnas» en los listados, como en la
 * planilla con la que trabajan hoy. Este módulo es la única pieza que traduce el orden que viaja en la
 * URL (`?orden=codigo&dir=desc`) a algo usable: **lista blanca de columnas por listado**, dirección
 * válida y un orden por defecto al que caer cuando la URL no se entiende.
 *
 * Dos reglas que no se negocian:
 * - El valor de la URL **nunca** llega a Prisma tal cual: si la columna no está declarada, se usa el
 *   orden por defecto. Así `?orden=loQueSea` no rompe la pantalla ni ordena por una columna interna.
 * - Ordenar o cambiar de página **no pierde los filtros**: los links de encabezado y de página salen de
 *   acá, con los mismos parámetros que ya estaban en la URL.
 */

export type DireccionOrden = "asc" | "desc";

/** Columna y dirección con las que se está mostrando un listado. */
export type OrdenDeListado<Col extends string = string> = {
  columna: Col;
  direccion: DireccionOrden;
};

/** Los dos parámetros que viajan en la URL. Se leen como texto porque vienen del querystring. */
export type OrdenEnUrl = { orden?: string; dir?: string };

/**
 * Lee el orden pedido en la URL contra la lista blanca del listado.
 *
 * - Columna desconocida o vacía → orden por defecto completo (columna y dirección).
 * - Columna conocida sin dirección válida → esa columna en ascendente (el primer clic del encabezado).
 */
export function leerOrden<Col extends string>(
  columnas: readonly Col[],
  porDefecto: OrdenDeListado<Col>,
  url: OrdenEnUrl = {}
): OrdenDeListado<Col> {
  const columna = url.orden as Col | undefined;
  if (!columna || !columnas.includes(columna)) return { ...porDefecto };
  const direccion: DireccionOrden = url.dir === "desc" ? "desc" : "asc";
  return { columna, direccion };
}

/**
 * Qué orden queda al clickear un encabezado: la primera vez esa columna en ascendente y, si ya estaba
 * ordenando por ella, invierte la dirección.
 */
export function alternarOrden<Col extends string>(
  actual: OrdenDeListado<Col>,
  columna: Col
): OrdenDeListado<Col> {
  if (actual.columna !== columna) return { columna, direccion: "asc" };
  return { columna, direccion: actual.direccion === "asc" ? "desc" : "asc" };
}

/** Lo que espera `aria-sort` en el `<th>`: la columna activa dice su dirección, las demás `none`. */
export function ariaSortDe<Col extends string>(
  actual: OrdenDeListado<Col>,
  columna: Col
): "ascending" | "descending" | "none" {
  if (actual.columna !== columna) return "none";
  return actual.direccion === "asc" ? "ascending" : "descending";
}

/**
 * Link del encabezado: arrastra los filtros activos, fija `orden`/`dir` y **vuelve a la página 1** (el
 * orden cambia qué filas caen en cada página) y descarta `notice`, que es el aviso de una acción.
 */
export function hrefConOrden(
  base: string,
  params: Record<string, string | undefined>,
  orden: OrdenDeListado
): string {
  const query = new URLSearchParams();
  for (const [clave, valor] of Object.entries(params)) {
    if (!valor || clave === "notice" || clave === "page") continue;
    query.set(clave, valor);
  }
  query.set("orden", orden.columna);
  query.set("dir", orden.direccion);
  return `${base}?${query.toString()}`;
}

/** Flecha del encabezado, para que se vea por dónde está ordenando sin abrir el código. */
export function flechaDeOrden<Col extends string>(
  actual: OrdenDeListado<Col>,
  columna: Col
): "↑" | "↓" | null {
  if (actual.columna !== columna) return null;
  return actual.direccion === "asc" ? "↑" : "↓";
}
