import { peorVencimiento, type UnidadConVencimientos } from "./compliance";

/**
 * Orden y paginación del listado de naves (`/admin/naves`).
 *
 * La flota cabe entera en memoria (decenas de unidades), así que se trae toda y se ordena acá:
 * algunas columnas no son campos de la base —«Vencimientos» es el papel más urgente de la unidad
 * y «Capacidad» la cantidad de asientos— y ordenarlas en SQL obligaría a duplicar esa lógica.
 * Todo viaja en la URL (`?orden=&dir=&page=`), así el listado se puede compartir y recargar.
 */

export const NAVES_POR_PAGINA = 20;

export const COLUMNAS_ORDENABLES = ["unidad", "vehiculo", "titular", "seguro", "vencimientos", "capacidad", "estado"] as const;
export type ColumnaNaves = (typeof COLUMNAS_ORDENABLES)[number];
export type Direccion = "asc" | "desc";

export type NaveDelListado = UnidadConVencimientos & {
  id: string;
  name: string;
  internalNumber: string | null;
  brand: string;
  model: string;
  licensePlate: string | null;
  owner: string | null;
  insurer: string | null;
  isActive: boolean;
  asientos: number;
};

export type OrdenDelListado = { orden: ColumnaNaves | null; dir: Direccion; page: number };

/** Lee los parámetros de la URL. Cualquier valor raro cae en el orden por defecto o en la página 1. */
export function leerOrdenDelListado(params: { orden?: string; dir?: string; page?: string } = {}): OrdenDelListado {
  const orden = (COLUMNAS_ORDENABLES as readonly string[]).includes(params.orden ?? "") ? (params.orden as ColumnaNaves) : null;
  const dir: Direccion = params.dir === "desc" ? "desc" : "asc";
  const page = Number.parseInt(params.page ?? "", 10);
  return { orden, dir, page: Number.isFinite(page) && page >= 1 ? page : 1 };
}

const comparador = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/** El nombre con que la operación conoce la unidad: el interno si lo tiene, si no el nombre. */
function claveUnidad(nave: NaveDelListado): string {
  return nave.internalNumber?.trim() || nave.name;
}

/**
 * Valor de la columna para ordenar. `null` = sin dato: va siempre al final, en los dos sentidos,
 * para que «sin titular» o «sin fechas cargadas» no tapen las unidades con datos.
 */
function valor(nave: NaveDelListado, columna: ColumnaNaves, hoy: Date): string | number | null {
  switch (columna) {
    case "unidad":
      return claveUnidad(nave);
    case "vehiculo":
      return `${nave.brand} ${nave.model} ${nave.licensePlate ?? ""}`.trim();
    case "titular":
      return nave.owner?.trim() || null;
    case "seguro":
      return nave.insurer?.trim() || null;
    case "vencimientos":
      // Días hasta el papel más urgente: lo vencido (negativo) primero en ascendente.
      return peorVencimiento(nave, hoy)?.dias ?? null;
    case "capacidad":
      return nave.asientos;
    case "estado":
      // Ascendente = activas primero, como el listado de siempre.
      return nave.isActive ? 0 : 1;
  }
}

function comparar(a: string | number | null, b: string | number | null): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return comparador.compare(String(a), String(b));
}

/** Orden por defecto: activas primero y después por interno, como estaba antes. */
function ordenPorDefecto(a: NaveDelListado, b: NaveDelListado): number {
  return Number(b.isActive) - Number(a.isActive) || comparador.compare(claveUnidad(a), claveUnidad(b));
}

export function ordenarNaves<T extends NaveDelListado>(naves: readonly T[], orden: ColumnaNaves | null, dir: Direccion, hoy: Date = new Date()): T[] {
  if (!orden) return [...naves].sort(ordenPorDefecto);
  const signo = dir === "desc" ? -1 : 1;
  return [...naves].sort((a, b) => {
    const va = valor(a, orden, hoy);
    const vb = valor(b, orden, hoy);
    if (va === null && vb === null) return ordenPorDefecto(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    return signo * comparar(va, vb) || ordenPorDefecto(a, b);
  });
}

export type PaginaDeNaves<T> = { items: T[]; total: number; page: number; totalPages: number; desde: number; hasta: number };

/** Una página pedida más allá de la última muestra la última, no una tabla vacía. */
export function paginarNaves<T>(naves: readonly T[], page: number, porPagina = NAVES_POR_PAGINA): PaginaDeNaves<T> {
  const total = naves.length;
  const totalPages = Math.max(1, Math.ceil(total / porPagina));
  const actual = Math.min(Math.max(1, page), totalPages);
  const inicio = (actual - 1) * porPagina;
  const items = naves.slice(inicio, inicio + porPagina);
  return { items, total, page: actual, totalPages, desde: total === 0 ? 0 : inicio + 1, hasta: inicio + items.length };
}

/**
 * A dónde lleva el encabezado de una columna: la primera vez ordena ascendente; si ya está ordenada
 * por esa columna, invierte el sentido. Cambiar el orden vuelve a la página 1.
 */
export function hrefDeOrden(actual: OrdenDelListado, columna: ColumnaNaves): string {
  const dir: Direccion = actual.orden === columna && actual.dir === "asc" ? "desc" : "asc";
  return `/admin/naves?orden=${columna}&dir=${dir}`;
}

export function hrefDePagina(actual: OrdenDelListado, page: number): string {
  const query = new URLSearchParams();
  if (actual.orden) {
    query.set("orden", actual.orden);
    query.set("dir", actual.dir);
  }
  if (page > 1) query.set("page", String(page));
  const texto = query.toString();
  return texto ? `/admin/naves?${texto}` : "/admin/naves";
}

/** Para `aria-sort` del encabezado. */
export function ariaSort(actual: OrdenDelListado, columna: ColumnaNaves): "ascending" | "descending" | "none" {
  if (actual.orden !== columna) return "none";
  return actual.dir === "asc" ? "ascending" : "descending";
}
