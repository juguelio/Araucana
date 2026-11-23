import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { dateOnly, localInput } from "@/lib/special-trips/data";
import "./escolares.css";

export default async function SchoolsPage({ searchParams }: { searchParams: Promise<{ tipo?: string; fecha?: string; aviso?: string }> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const personal = params.tipo === "personal";
  const kind = personal ? "PERSONAL" : "ESCOLAR";
  const suffix = personal ? "&tipo=personal" : "";
  const today = dateOnly(localInput(new Date()).slice(0, 10))!;
  const requested = dateOnly(params.fecha ?? "");
  const next = requested ? null : await prisma.schoolRun.findFirst({
    where: { kind, serviceDate: { gte: today } }, orderBy: { serviceDate: "asc" }, select: { serviceDate: true }
  });
  const day = requested ?? next?.serviceDate ?? today;
  const date = day.toISOString().slice(0, 10);
  const [runs, days] = await Promise.all([
    prisma.schoolRun.findMany({ where: { kind, serviceDate: day }, orderBy: [{ routeName: "asc" }, { id: "asc" }],
      include: { driver: { select: { name: true, email: true } }, vehicle: { select: { name: true } } } }),
    prisma.schoolRun.groupBy({ by: ["serviceDate"], where: { kind, serviceDate: {
      gte: new Date(+day - 7 * 86400000), lte: new Date(+day + 7 * 86400000)
    } }, orderBy: { serviceDate: "asc" } })
  ]);
  return <AdminShell title={personal ? "Traslados de personal" : "Escolares"} eyebrow="Operación" role={user.role} notice={params.aviso}
    action={<Link className="button" href={`/admin/escolares/nuevo?fecha=${date}${suffix}`}>Nuevo recorrido</Link>}>
    <section className="plain-card admin-section">
      <form className="inline-actions">{personal && <input type="hidden" name="tipo" value="personal" />}<label>Fecha de servicio <input type="date" name="fecha" defaultValue={date} required /></label><button className="ghost-button">Ver día</button></form>
      <nav className="school-days" aria-label="Días con recorridos">{days.map(({ serviceDate }) => {
        const iso = serviceDate.toISOString().slice(0, 10);
        return <Link key={iso} aria-current={iso === date ? "date" : undefined} className={iso === date ? "button" : "ghost-button"} href={`?fecha=${iso}${suffix}`}>{serviceDate.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" })}</Link>;
      })}</nav>
    </section>
    <section className="plain-card admin-section">
      <h2>{day.toLocaleDateString("es-AR", { dateStyle: "long", timeZone: "UTC" })}</h2>
      {!runs.length ? <p className="muted">No hay recorridos para este día.</p> : <div className="table-scroll">
        <table className="data-table"><thead><tr>{["Recorrido", "Turno u horario", "Chofer", "Nave", "Estado"].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{runs.map(run => <tr key={run.id}>
            <td><Link className="table-link" href={`/admin/escolares/${run.id}`}>{run.routeName}</Link></td>
            <td>{run.shift}</td><td>{run.driver?.name ?? run.driver?.email ?? "Sin asignar"}</td><td>{run.vehicle?.name ?? "Sin asignar"}</td>
            <td><span className="pill">{run.review || !run.driverId || !run.vehicleId ? "Revisar" : "Asignado"}</span></td>
          </tr>)}</tbody></table>
      </div>}
    </section>
  </AdminShell>;
}
