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
 * `clavePagina` es el nombre del parámetro de página del listado (`page` en casi todos, `pagina` en
 * viajes especiales).
 */
export function hrefConOrden(
  base: string,
  params: Record<string, string | string[] | undefined>,
  orden: OrdenDeListado,
  clavePagina = "page",
  claves: { orden?: string; dir?: string } = {}
): string {
  const claveOrden = claves.orden ?? "orden";
  const claveDir = claves.dir ?? "dir";
  const query = new URLSearchParams();
  for (const [clave, valor] of Object.entries(params)) {
    if (typeof valor !== "string" || !valor || clave === "notice" || clave === clavePagina) continue;
    query.set(clave, valor);
  }
  query.set(claveOrden, orden.columna);
  query.set(claveDir, orden.direccion);
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

/** Página pedida en la URL: cualquier cosa que no sea un entero positivo es la página 1. */
export function leerPagina(valor: string | string[] | undefined): number {
  const numero = typeof valor === "string" && /^\d{1,6}$/.test(valor) ? Number(valor) : 1;
  return numero >= 1 ? numero : 1;
}

/**
 * Link a otra página del listado: arrastra filtros y orden, descarta `notice` y omite la página 1
 * (así la URL de la primera página queda limpia).
 */
export function hrefDePagina(
  base: string,
  params: Record<string, string | string[] | undefined>,
  pagina: number,
  clavePagina = "page"
): string {
  const query = new URLSearchParams();
  for (const [clave, valor] of Object.entries(params)) {
    if (typeof valor !== "string" || !valor || clave === "notice" || clave === clavePagina) continue;
    query.set(clave, valor);
  }
  if (pagina > 1) query.set(clavePagina, String(pagina));
  const texto = query.toString();
  return texto ? `${base}?${texto}` : base;
}

/** Valor de una celda para ordenar. `null` = sin dato: va siempre al final, en los dos sentidos. */
export type ValorDeOrden = string | number | Date | boolean | null | undefined;

const comparadorDeTexto = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

function compararValores(a: Exclude<ValorDeOrden, null | undefined>, b: Exclude<ValorDeOrden, null | undefined>): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return comparadorDeTexto.compare(String(a), String(b));
}

function vacio(valor: ValorDeOrden): valor is null | undefined {
  return valor === null || valor === undefined || (typeof valor === "string" && valor.trim() === "");
}

/**
 * Ordena en memoria los listados que se traen enteros (decenas de filas) o cuyas columnas se calculan
 * (vencimientos, estado derivado): ordenarlos en SQL obligaría a duplicar esa lógica.
 *
 * - Los vacíos van al final en ascendente y en descendente, para que «sin dato» no tape las filas útiles.
 * - El orden es estable: a igual valor, las filas quedan como llegaron (el orden por defecto del listado).
 */
export function ordenarEnMemoria<T, Col extends string>(
  items: readonly T[],
  orden: OrdenDeListado<Col>,
  valores: Record<Col, (item: T) => ValorDeOrden>
): T[] {
  const valorDe = valores[orden.columna];
  const signo = orden.direccion === "desc" ? -1 : 1;
  return items
    .map((item, indice) => ({ item, indice, valor: valorDe(item) }))
    .sort((a, b) => {
      const aVacio = vacio(a.valor);
      const bVacio = vacio(b.valor);
      if (aVacio || bVacio) return aVacio === bVacio ? a.indice - b.indice : aVacio ? 1 : -1;
      return signo * compararValores(a.valor!, b.valor!) || a.indice - b.indice;
    })
    .map(({ item }) => item);
}

export type PaginaDeListado<T> = { items: T[]; total: number; page: number; totalPages: number; desde: number; hasta: number };

/** Una página de un listado en memoria. Pedir más allá de la última muestra la última, no una tabla vacía. */
export function paginar<T>(items: readonly T[], page: number, porPagina: number): PaginaDeListado<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / porPagina));
  const actual = Math.min(Math.max(1, page), totalPages);
  const inicio = (actual - 1) * porPagina;
  const pagina = items.slice(inicio, inicio + porPagina);
  return { items: pagina, total, page: actual, totalPages, desde: total === 0 ? 0 : inicio + 1, hasta: inicio + pagina.length };
}

/** Los números de una página que se pagina en la base (`skip`/`take`), con la misma forma que `paginar`. */
export function rangoDePagina(total: number, pedida: number, porPagina: number) {
  const totalPages = Math.max(1, Math.ceil(total / porPagina));
  const page = Math.min(Math.max(1, pedida), totalPages);
  const desde = total === 0 ? 0 : (page - 1) * porPagina + 1;
  const hasta = Math.min(page * porPagina, total);
  return { total, page, totalPages, desde, hasta, skip: (page - 1) * porPagina };
}
