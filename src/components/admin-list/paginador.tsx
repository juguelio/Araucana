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
};

/**
 * Paginador de los listados del panel: «← Anterior · Mostrando X–Y de Z · página N de M · Siguiente →»,
 * el mismo de Reservas. Si todo entra en una página no se dibuja.
 */
export function Paginador({ page, totalPages, total, desde, hasta, hrefPagina, etiqueta }: PaginadorProps) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label={`Paginación de ${etiqueta}`}>
      {page > 1 ? (
        <Link className="pagination-link" href={hrefPagina(page - 1)} rel="prev">← Anterior</Link>
      ) : (
        <span aria-disabled="true" className="pagination-link">← Anterior</span>
      )}
      <span className="pagination-status">
        Mostrando {desde}–{hasta} de {total} · página {page} de {totalPages}
      </span>
      {page < totalPages ? (
        <Link className="pagination-link" href={hrefPagina(page + 1)} rel="next">Siguiente →</Link>
      ) : (
        <span aria-disabled="true" className="pagination-link">Siguiente →</span>
      )}
    </nav>
  );
}
