import Link from "next/link";
import "./pagination.css";

type PaginadorProps = {
  page: number;
  totalPages: number;
  total: number;
  desde: number;
  hasta: number;
  /** Link de cada página (arrastra filtros y orden: ver `hrefDePagina`). */
  hrefPagina: (pagina: number) => string;
  /** Para `aria-label`: «Paginación de {etiqueta}». */
  etiqueta: string;
  /** Filas por página en curso y los tamaños ofrecidos. Sin `hrefTamano` no se dibuja el selector. */
  pageSize?: number;
  tamanos?: readonly number[];
  hrefTamano?: (filas: number) => string;
};

/**
 * Números de página que entran en la barra: la primera, la última y las vecinas de la actual.
 * Con muchas páginas se cortan con «…» para no llenar la pantalla de números.
 */
function paginasVisibles(page: number, totalPages: number): Array<number | "…"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const vecinas = [page - 1, page, page + 1].filter((n) => n > 1 && n < totalPages);
  const salida: Array<number | "…"> = [1];
  if (vecinas.length && vecinas[0] > 2) salida.push("…");
  salida.push(...vecinas);
  if (vecinas.length && vecinas[vecinas.length - 1] < totalPages - 1) salida.push("…");
  salida.push(totalPages);
  return salida;
}

/**
 * Paginador de los listados del panel: «Primera · Anterior · números · Siguiente · Última»,
 * «Mostrando X–Y de Z» y, si el listado lo ofrece, cuántas filas por página.
 * Se dibuja si hay más de una página o si hay selector de tamaño: con una sola página igual
 * se puede pasar a ver más filas.
 */
export function Paginador({
  page,
  totalPages,
  total,
  desde,
  hasta,
  hrefPagina,
  etiqueta,
  pageSize,
  tamanos,
  hrefTamano
}: PaginadorProps) {
  const hayTamano = Boolean(hrefTamano && tamanos?.length && pageSize);
  if (totalPages <= 1 && !hayTamano) return null;
  return (
    <nav className="pagination" aria-label={`Paginación de ${etiqueta}`}>
      {page > 1 ? (
        <Link className="pagination-link" href={hrefPagina(1)} aria-label="Primera página">
          « Primera
        </Link>
      ) : (
        <span aria-disabled="true" className="pagination-link">
          « Primera
        </span>
      )}
      {page > 1 ? (
        <Link className="pagination-link" href={hrefPagina(page - 1)} rel="prev">
          ← Anterior
        </Link>
      ) : (
        <span aria-disabled="true" className="pagination-link">
          ← Anterior
        </span>
      )}
      {totalPages > 1 ? (
        <span className="pagination-numeros">
          {paginasVisibles(page, totalPages).map((numero, indice) =>
            numero === "…" ? (
              <span className="pagination-corte" key={`corte-${indice}`} aria-hidden="true">
                …
              </span>
            ) : numero === page ? (
              <span aria-current="page" className="pagination-link pagination-actual" key={numero}>
                {numero}
              </span>
            ) : (
              <Link className="pagination-link" href={hrefPagina(numero)} key={numero}>
                {numero}
              </Link>
            )
          )}
        </span>
      ) : null}
      {page < totalPages ? (
        <Link className="pagination-link" href={hrefPagina(page + 1)} rel="next">
          Siguiente →
        </Link>
      ) : (
        <span aria-disabled="true" className="pagination-link">
          Siguiente →
        </span>
      )}
      {page < totalPages ? (
        <Link className="pagination-link" href={hrefPagina(totalPages)} aria-label="Última página">
          Última »
        </Link>
      ) : (
        <span aria-disabled="true" className="pagination-link">
          Última »
        </span>
      )}
      <span className="pagination-status">
        Mostrando {desde}–{hasta} de {total} · página {page} de {totalPages}
      </span>
      {hayTamano ? (
        <span className="pagination-tamano">
          Filas por página{" "}
          {tamanos!.map((tamano) =>
            tamano === pageSize ? (
              <span aria-current="true" className="pagination-link pagination-actual" key={tamano}>
                {tamano}
              </span>
            ) : (
              <Link className="pagination-link" href={hrefTamano!(tamano)} key={tamano}>
                {tamano}
              </Link>
            )
          )}
        </span>
      ) : null}
    </nav>
  );
}
