import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { Paginador } from "@/components/admin-list/paginador";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { hrefDePagina, leerPagina, paginar } from "@/lib/admin/list-order";
import {
  AREA_LABEL,
  contarPorArea,
  filtrarRecorridos,
  leerAreaDeRecorrido,
  leerFiltroDeRecorridos,
  type AreaDeRecorrido,
  type FiltroDeRecorridos
} from "@/lib/vehicles/ficha";
import { CabeceraDeNave, SinDatos, cargarNave, fechaDeRecorrido, fechaHora, hrefDeNave, nombreDeNave } from "../ficha-de-nave";
import { cargarRecorridos } from "../datos";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ momento?: string; area?: string; page?: string; notice?: string }>;
};

const POR_PAGINA = 25;

const MOMENTOS: Array<{ momento: FiltroDeRecorridos; label: string }> = [
  { momento: "todos", label: "Todos" },
  { momento: "proximos", label: "Por delante" },
  { momento: "pasados", label: "Hechos" }
];

/** Historial de recorridos de una nave: salidas, viajes especiales, aeropuerto y Chapelco juntos. */
export default async function RecorridosDeNavePage({ params, searchParams }: Props) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const momento = leerFiltroDeRecorridos(query.momento);
  const area = leerAreaDeRecorrido(query.area);
  const hoy = new Date();
  const nave = await cargarNave(id);
  const todos = await cargarRecorridos(id);
  const porArea = contarPorArea(filtrarRecorridos(todos, momento, null, hoy));
  const pagina = paginar(filtrarRecorridos(todos, momento, area, hoy), leerPagina(query.page), POR_PAGINA);
  const base = hrefDeNave(id, "recorridos");

  const hrefFiltro = (cambios: { momento?: FiltroDeRecorridos; area?: AreaDeRecorrido | null }) => {
    const m = cambios.momento ?? momento;
    const a = cambios.area === undefined ? area : cambios.area;
    return hrefDePagina(base, { momento: m === "todos" ? undefined : m, area: a ?? undefined }, 1);
  };

  return (
    <AdminShell role={sessionUser.role} title={nombreDeNave(nave)} eyebrow="Naves · Recorridos" notice={query.notice}>
      <CabeceraDeNave nave={nave} seccion="recorridos" hoy={hoy} />

      <section className="plain-card admin-section" aria-labelledby="recorridos-titulo">
        <h2 id="recorridos-titulo">Historial de recorridos</h2>
        <div className="nave-filtros" role="group" aria-label="Cuándo">
          {MOMENTOS.map((m) => (
            <Link key={m.momento} className="nave-chip" href={hrefFiltro({ momento: m.momento })} aria-current={m.momento === momento ? "true" : undefined}>
              {m.label}
            </Link>
          ))}
        </div>
        <div className="nave-filtros" role="group" aria-label="Área">
          <Link className="nave-chip" href={hrefFiltro({ area: null })} aria-current={area === null ? "true" : undefined}>
            Todas las áreas
          </Link>
          {(Object.keys(AREA_LABEL) as AreaDeRecorrido[]).map((a) => (
            <Link key={a} className="nave-chip" href={hrefFiltro({ area: a })} aria-current={a === area ? "true" : undefined}>
              {AREA_LABEL[a]} <span className="muted">{porArea[a]}</span>
            </Link>
          ))}
        </div>

        {pagina.total === 0 ? (
          <SinDatos titulo={todos.length === 0 ? "Esta nave todavía no hizo ningún recorrido." : "No hay recorridos con este filtro."}>
            {todos.length === 0 ? "Aparecen acá cuando se la asigna a una salida, un viaje especial, un vuelo o un día de Chapelco." : null}
          </SinDatos>
        ) : (
          <div className="table-scroll">
            <table className="data-table nave-tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Área</th>
                  <th>Servicio</th>
                  <th>Chofer</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {pagina.items.map((r) => (
                  <tr key={r.key}>
                    <td data-label="Fecha">
                      {fechaDeRecorrido(r)}
                      {r.hasta ? (
                        <>
                          <br />
                          <span className="muted">hasta {fechaHora(r.hasta)}</span>
                        </>
                      ) : null}
                    </td>
                    <td data-label="Área">{AREA_LABEL[r.area]}</td>
                    <td data-label="Servicio">
                      {r.href ? <Link href={r.href}>{r.titulo}</Link> : r.titulo}
                      {r.detalle ? (
                        <>
                          <br />
                          <span className="muted">{r.detalle}</span>
                        </>
                      ) : null}
                    </td>
                    <td data-label="Chofer">{r.chofer ?? <span className="muted">sin chofer</span>}</td>
                    <td data-label="Estado">{r.estado ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginador
          page={pagina.page}
          totalPages={pagina.totalPages}
          total={pagina.total}
          desde={pagina.desde}
          hasta={pagina.hasta}
          etiqueta="recorridos"
          hrefPagina={(n) => hrefDePagina(base, { momento: momento === "todos" ? undefined : momento, area: area ?? undefined }, n)}
        />
      </section>
    </AdminShell>
  );
}
