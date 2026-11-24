import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { ConcesionesNav } from "@/components/concesiones-nav";
import { ConcesionesVistaNav } from "@/components/concesiones-vista-nav";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { dateOnly, localInput } from "@/lib/special-trips/data";
import { etiquetaDeConcesion, leerTipoDeConcesion } from "@/lib/school-runs/kinds";
import { diasDeSemana, etiquetaDeSemana, leerSemana, lunesDe, sumarDias } from "@/lib/school-runs/week";
import "../escolares.css";

const diaLargo = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const diaCorto = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" });
const mesCorto = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });

function fechaDe(dia: string) {
  return new Date(`${dia}T12:00:00.000Z`);
}

export default async function WeekPage({ searchParams }: {
  searchParams: Promise<{ semana?: string; tipo?: string; vista?: string; aviso?: string }>;
}) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const tipo = leerTipoDeConcesion(params.tipo);
  const vista = params.vista === "chofer" ? "chofer" : "dia";
  const hoy = dateOnly(localInput(new Date()).slice(0, 10))!.toISOString().slice(0, 10);
  const semana = lunesDe(leerSemana(params.semana) ?? hoy);
  const dias = diasDeSemana(semana);
  const desde = new Date(`${dias[0]}T00:00:00.000Z`);
  const hasta = new Date(`${dias[6]}T00:00:00.000Z`);
  const runs = await prisma.schoolRun.findMany({
    where: { serviceDate: { gte: desde, lte: hasta }, ...(tipo ? { kind: tipo } : {}) },
    orderBy: [{ serviceDate: "asc" }, { shift: "asc" }, { routeName: "asc" }],
    include: { driver: { select: { name: true, email: true } }, vehicle: { select: { name: true } } }
  });
  const porDia = new Map(dias.map((dia) => [dia, [] as typeof runs]));
  const porChofer = new Map<string, { nombre: string; dias: Map<string, typeof runs> }>();
  for (const run of runs) {
    const dia = run.serviceDate.toISOString().slice(0, 10);
    porDia.get(dia)?.push(run);
    const clave = run.driverId ?? "sin-chofer";
    const fila = porChofer.get(clave) ?? {
      nombre: run.driver?.name ?? run.driver?.email ?? "Sin chofer",
      dias: new Map(dias.map((d) => [d, [] as typeof runs]))
    };
    fila.dias.get(dia)?.push(run);
    porChofer.set(clave, fila);
  }
  const choferes = [...porChofer.entries()]
    .map(([clave, fila]) => ({ clave, ...fila, total: [...fila.dias.values()].reduce((n, delDia) => n + delDia.length, 0) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const hrefSemana = (inicio: string) => {
    const query = new URLSearchParams();
    if (tipo) query.set("tipo", tipo);
    if (vista === "chofer") query.set("vista", "chofer");
    query.set("semana", inicio);
    return `/admin/escolares/semana?${query.toString()}`;
  };
  const hrefVista = (nueva: "dia" | "chofer") => {
    const query = new URLSearchParams();
    if (tipo) query.set("tipo", tipo);
    if (nueva === "chofer") query.set("vista", "chofer");
    query.set("semana", semana);
    return `/admin/escolares/semana?${query.toString()}`;
  };
  const hrefNuevo = (fecha: string) =>
    `/admin/escolares/nuevo?fecha=${fecha}${tipo ? `&tipo=${tipo}` : ""}`;
  const hrefDia = (fecha: string) =>
    `/admin/escolares?fecha=${fecha}${tipo ? `&tipo=${tipo}` : ""}`;

  return (
    <AdminShell title="Concesiones" eyebrow="Semana" role={user.role} notice={params.aviso}
      action={<div className="inline-actions"><Link className="ghost-button" href="/admin/escolares/importar">Importar planilla</Link><Link className="button" href={hrefNuevo(hoy >= dias[0] && hoy <= dias[6] ? hoy : semana)}>Nuevo servicio</Link></div>}>
      <ConcesionesNav actual={tipo ?? "todos"} semana={semana} />
      <ConcesionesVistaNav actual="semana" tipo={tipo} fecha={semana} semana={semana} />
      <div className="cn-semana-nav">
        <Link className="ghost-button" href={hrefSemana(sumarDias(semana, -7))}>‹ Semana anterior</Link>
        <strong>{etiquetaDeSemana(semana)}</strong>
        <Link className="ghost-button" href={hrefSemana(sumarDias(semana, 7))}>Semana siguiente ›</Link>
        {semana !== lunesDe(hoy) ? <Link className="ghost-button" href={hrefSemana(lunesDe(hoy))}>Esta semana</Link> : null}
        <span className="muted">{runs.length} {runs.length === 1 ? "servicio" : "servicios"}</span>
        <span className="cn-vista-toggle">
          <Link className={`pill${vista === "dia" ? " is-active" : ""}`} href={hrefVista("dia")}>Por día</Link>
          <Link className={`pill${vista === "chofer" ? " is-active" : ""}`} href={hrefVista("chofer")}>Por chofer</Link>
        </span>
      </div>
      {vista === "chofer" ? (
        <section className="cn-choferes" aria-label={`Semana por chofer del ${etiquetaDeSemana(semana)}`}>
          <div className="cn-choferes-scroll">
            <table className="cn-choferes-tabla">
              <thead>
                <tr>
                  <th>Chofer</th>
                  {dias.map((dia) => {
                    const fecha = fechaDe(dia);
                    return <th key={dia} data-hoy={dia === hoy || undefined}><span>{diaCorto.format(fecha)}</span><strong>{fecha.getUTCDate()}</strong><small>{mesCorto.format(fecha)}</small></th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {choferes.length === 0 ? (
                  <tr><td colSpan={8} className="cn-choferes-vacio">No hay servicios esta semana.</td></tr>
                ) : choferes.map((chofer) => (
                  <tr key={chofer.clave}>
                    <th scope="row"><strong>{chofer.nombre}</strong><small>{chofer.total} {chofer.total === 1 ? "servicio" : "servicios"}</small></th>
                    {dias.map((dia) => (
                      <td key={dia} data-hoy={dia === hoy || undefined}>
                        {(chofer.dias.get(dia) ?? []).map((run) => (
                          <Link key={run.id} className="cn-chofer-servicio" href={hrefDia(dia)}>
                            <strong>{run.routeName}</strong>
                            <span>{run.shift} · {run.vehicle?.name ?? "Sin nave"}</span>
                          </Link>
                        ))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
      <section className="cn-semana" aria-label={`Semana del ${etiquetaDeSemana(semana)}`}>
        <div className="cn-semana-scroll">
          <div className="cn-semana-grid">
            {dias.map((dia) => {
              const delDia = porDia.get(dia) ?? [];
              const fecha = fechaDe(dia);
              return (
                <article key={dia} className="cn-semana-dia" data-hoy={dia === hoy}>
                  <header>
                    <span>{diaCorto.format(fecha)}</span>
                    <strong>{fecha.getUTCDate()}</strong>
                    <small>{mesCorto.format(fecha)}</small>
                  </header>
                  <div className="cn-semana-pie cn-semana-pie-top">
                    <Link className="cn-semana-ver-dia" href={hrefDia(dia)}>Ver el día →</Link>
                    <Link className="cn-semana-agregar" href={hrefNuevo(dia)}>+ Agregar</Link>
                  </div>
                  <p className="muted">{delDia.length ? `${delDia.length} ${delDia.length === 1 ? "servicio" : "servicios"}` : "Sin servicios"}</p>
                  <div className="cn-semana-lista">
                    {delDia.map((run) => (
                      <Link key={run.id} className="cn-semana-servicio" href={hrefDia(dia)} title={diaLargo.format(fecha)}>
                        <strong>{run.routeName}</strong>
                        <span>{run.shift}{run.companion ? ` · ${run.companion}` : ""}</span>
                        <span className="pill">{etiquetaDeConcesion(run.kind)}</span>
                        <span>{run.driver?.name ?? run.driver?.email ?? "Sin chofer"} · {run.vehicle?.name ?? "Sin nave"}</span>
                      </Link>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
      )}
    </AdminShell>
  );
}
