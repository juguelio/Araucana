import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { ConcesionesNav } from "@/components/concesiones-nav";
import { ConcesionesVistaNav } from "@/components/concesiones-vista-nav";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { dateOnly, localInput } from "@/lib/special-trips/data";
import { etiquetaDeConcesion, leerTipoDeConcesion } from "@/lib/school-runs/kinds";
import { lunesDe } from "@/lib/school-runs/week";
import "./escolares.css";

export default async function SchoolsPage({ searchParams }: { searchParams: Promise<{ fecha?: string; tipo?: string; aviso?: string }> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const tipo = leerTipoDeConcesion(params.tipo);
  const today = dateOnly(localInput(new Date()).slice(0, 10))!;
  const requested = dateOnly(params.fecha ?? "");
  const next = requested ? null : await prisma.schoolRun.findFirst({
    where: { serviceDate: { gte: today }, ...(tipo ? { kind: tipo } : {}) }, orderBy: { serviceDate: "asc" }, select: { serviceDate: true }
  });
  const day = requested ?? next?.serviceDate ?? today;
  const date = day.toISOString().slice(0, 10);
  const [runs, days] = await Promise.all([
    prisma.schoolRun.findMany({ where: { serviceDate: day, ...(tipo ? { kind: tipo } : {}) }, orderBy: [{ routeName: "asc" }, { id: "asc" }],
      include: { driver: { select: { name: true, email: true } }, vehicle: { select: { name: true } } } }),
    prisma.schoolRun.groupBy({ by: ["serviceDate"], where: { serviceDate: {
      gte: new Date(+day - 7 * 86400000), lte: new Date(+day + 7 * 86400000)
    }, ...(tipo ? { kind: tipo } : {}) }, orderBy: { serviceDate: "asc" } })
  ]);
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
        <table className="data-table"><thead><tr>{["Servicio", "Tipo", "Turno u horario", "Chofer", "Nave", "Estado"].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{runs.map(run => <tr key={run.id}>
            <td><Link className="table-link" href={`/admin/escolares/${run.id}`}>{run.routeName}</Link></td>
            <td><span className="pill">{etiquetaDeConcesion(run.kind)}</span></td>
            <td>{run.shift}</td><td>{run.driver?.name ?? run.driver?.email ?? "Sin asignar"}</td><td>{run.vehicle?.name ?? "Sin asignar"}</td>
            <td><span className="pill">{run.review || !run.driverId || !run.vehicleId ? "Revisar" : "Asignado"}</span></td>
          </tr>)}</tbody></table>
      </div>}
    </section>
  </AdminShell>;
}
