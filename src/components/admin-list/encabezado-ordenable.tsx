import Link from "next/link";
import { alternarOrden, ariaSortDe, flechaDeOrden, hrefConOrden, type OrdenDeListado } from "@/lib/admin/list-order";
import "./pagination.css";

type EncabezadoOrdenableProps<Col extends string> = {
  etiqueta: string;
  columna: Col;
  orden: OrdenDeListado<Col>;
  /** Ruta del listado, p. ej. `/admin/pasajeros`. */
  base: string;
  /** Parámetros actuales de la URL: los filtros viajan en el link del encabezado. */
  params: Record<string, string | string[] | undefined>;
  /** Nombre del parámetro de página del listado (se borra al ordenar: vuelve a la página 1). */
  clavePagina?: string;
  className?: string;
};

/**
 * Encabezado ordenable de los listados del panel (issue #192): el primer clic ordena por esa columna
 * en ascendente y el segundo invierte. El link arrastra los filtros activos y vuelve a la página 1;
 * `aria-sort` le dice el estado a los lectores de pantalla.
 */
export function EncabezadoOrdenable<Col extends string>({
  etiqueta, columna, orden, base, params, clavePagina, className
}: EncabezadoOrdenableProps<Col>) {
  const flecha = flechaDeOrden(orden, columna);
  const siguiente = alternarOrden(orden, columna);
  return (
    <th aria-sort={ariaSortDe(orden, columna)} className={className}>
      <Link
        className="orden-col"
        href={hrefConOrden(base, params, siguiente, clavePagina)}
        title={`Ordenar por ${etiqueta.toLowerCase()} (${siguiente.direccion === "asc" ? "de menor a mayor" : "de mayor a menor"})`}
      >
        {etiqueta}
        <span aria-hidden="true" className="orden-col-flecha">{flecha ?? "↕"}</span>
      </Link>
    </th>
  );
}

/** Los dos campos ocultos que hacen que filtrar no pierda el orden elegido. */
export function OrdenOculto({ orden }: { orden: OrdenDeListado }) {
  return (
    <>
      <input type="hidden" name="orden" value={orden.columna} />
      <input type="hidden" name="dir" value={orden.direccion} />
    </>
  );
}
