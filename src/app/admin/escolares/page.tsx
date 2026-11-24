import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { ConcesionesNav } from "@/components/concesiones-nav";
import { ConcesionesVistaNav } from "@/components/concesiones-vista-nav";
import { AsignarRecursosConcesion } from "./asignar-recursos";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { dateOnly } from "@/lib/special-trips/data";
import { etiquetaDeConcesion, leerTipoDeConcesion } from "@/lib/school-runs/kinds";
import { lunesDe } from "@/lib/school-runs/week";
import "./escolares.css";

export default async function SchoolsPage({ searchParams }: { searchParams: Promise<{ fecha?: string; tipo?: string; aviso?: string }> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const tipo = leerTipoDeConcesion(params.tipo);
  if (!params.fecha) {
    const query = new URLSearchParams();
    if (tipo) query.set("tipo", tipo);
    if (params.aviso) query.set("aviso", params.aviso);
    redirect(`/admin/escolares/semana${query.size ? `?${query}` : ""}`);
  }
  const day = dateOnly(params.fecha);
  if (!day) redirect(`/admin/escolares/semana${tipo ? `?tipo=${tipo}` : ""}`);
  const date = day.toISOString().slice(0, 10);
  const [runs, days, naves, choferes] = await Promise.all([
    prisma.schoolRun.findMany({ where: { serviceDate: day, ...(tipo ? { kind: tipo } : {}) }, orderBy: [{ routeName: "asc" }, { id: "asc" }],
      include: { driver: { select: { name: true, email: true } }, vehicle: { select: { name: true } } } }),
    prisma.schoolRun.groupBy({ by: ["serviceDate"], where: { serviceDate: {
      gte: new Date(+day - 7 * 86400000), lte: new Date(+day + 7 * 86400000)
    }, ...(tipo ? { kind: tipo } : {}) }, orderBy: { serviceDate: "asc" } }),
    prisma.vehicle.findMany({
      where: { isActive: true, kind: { not: "UTILITARIO" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, internalNumber: true, licensePlate: true }
    }),
    prisma.user.findMany({
      where: { role: "DRIVER", isActive: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true }
    })
  ]);
  const returnTo = `/admin/escolares?fecha=${date}${tipo ? `&tipo=${tipo}` : ""}`;
  return <AdminShell title="Concesiones" eyebrow="Servicios recurrentes" role={user.role} notice={params.aviso}
    action={<div className="inline-actions"><Link className="ghost-button" href="/admin/escolares/importar">Importar planilla</Link><Link className="button" href={`/admin/escolares/nuevo?fecha=${date}${tipo ? `&tipo=${tipo}` : ""}`}>Nuevo servicio</Link></div>}>
    <ConcesionesNav actual={tipo ?? "todos"} fecha={date} />
    <ConcesionesVistaNav actual="dia" tipo={tipo} fecha={date} semana={lunesDe(date)} />
    {tipo === "personal-aeropuerto" ? <p className="muted school-kind-help">Traslado diario de personal, por ejemplo al aeropuerto. No es el tablero de vuelos de pasajeros: eso sigue en Aeropuerto.</p> : null}
    <section className="plain-card admin-section">
      <form className="inline-actions">{tipo ? <input type="hidden" name="tipo" value={tipo} /> : null}<label>Fecha de servicio <input type="date" name="fecha" defaultValue={date} required /></label><button className="ghost-button">Ver día</button></form>
      <nav className="school-days" aria-label="Días con recorridos">{days.map(({ serviceDate }) => {
        const iso = serviceDate.toISOString().slice(0, 10);
        return <Link key={iso} aria-current={iso === date ? "date" : undefined} className={iso === date ? "button" : "ghost-button"} href={`?fecha=${iso}${tipo ? `&tipo=${tipo}` : ""}`}>{serviceDate.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" })}</Link>;
      })}</nav>
    </section>
    <section className="plain-card admin-section">
      <h2>{day.toLocaleDateString("es-AR", { dateStyle: "long", timeZone: "UTC" })}</h2>
      {!runs.length ? <p className="muted">No hay servicios {tipo ? etiquetaDeConcesion(tipo).toLowerCase() : "recurrentes"} para este día.</p> : <div className="table-scroll">
        <table className="data-table concesiones-dia-tabla"><thead><tr>{["Servicio", "Tipo", "Turno u horario", "Chofer", "Nave", "Estado"].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{runs.map(run => <tr key={run.id}>
            <td><Link className="table-link" href={`/admin/escolares/${run.id}`}>{run.routeName}</Link></td>
            <td><span className="pill">{etiquetaDeConcesion(run.kind)}</span></td>
            <td>{run.shift}</td><td>{run.driver?.name ?? run.driver?.email ?? "Sin chofer"}</td><td>{run.vehicle?.name ?? "Sin nave"}</td>
            <td><AsignarRecursosConcesion
              id={run.id}
              titulo={run.routeName}
              subtitulo={run.shift}
              fecha={date}
              revision={run.revision}
              returnTo={returnTo}
              naves={naves}
              choferes={choferes.map((chofer) => ({ id: chofer.id, label: chofer.name?.trim() || chofer.email, email: chofer.email }))}
              naveActual={run.vehicleId ?? ""}
              choferActual={run.driverId ?? ""}
              trigger={!run.driverId || !run.vehicleId ? "Asignar" : run.review ? "Revisar" : "Asignado"}
              triggerClassName={`pill school-assign-trigger${!run.driverId || !run.vehicleId ? " school-assign-trigger-pendiente" : ""}`}
            /></td>
          </tr>)}</tbody></table>
      </div>}
    </section>
  </AdminShell>;
}
