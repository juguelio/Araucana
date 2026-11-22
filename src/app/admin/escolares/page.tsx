import { randomUUID } from "node:crypto";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { dateOnly, localInput } from "@/lib/special-trips/data";
import { saveSchoolRun } from "./actions";
import type { SchoolRun } from "@prisma/client";
import "./escolares.css";

type Option = { id: string; name: string | null };
type FormProps = { run?: SchoolRun; date: string; drivers: Option[]; vehicles: Option[] };
function RunForm({ run, date, drivers, vehicles }: FormProps) {
  return <form action={saveSchoolRun} className="school-form">
    <input type="hidden" name="id" value={run?.id ?? randomUUID()} />
    <input type="hidden" name="revision" value={run?.revision ?? ""} />
    <label>Fecha<input type="date" name="date" required defaultValue={date} /></label>
    <label>Recorrido<input name="routeName" required maxLength={400} defaultValue={run?.routeName} /></label>
    <label>Turno u horario<input name="shift" required maxLength={100} defaultValue={run?.shift} placeholder="Ej. Mañana o 08:00–12:00" /></label>
    <label>Chofer<select name="driverId" defaultValue={run?.driverId ?? ""}><option value="">Sin asignar</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    <label>Nave<select name="vehicleId" defaultValue={run?.vehicleId ?? ""}><option value="">Sin asignar</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
    <label>Segunda persona<input name="companion" maxLength={200} defaultValue={run?.companion ?? ""} /></label>
    <label>Observaciones<textarea name="notes" maxLength={2000} defaultValue={run?.notes ?? ""} /></label>
    <label>Pendiente de revisión<textarea name="review" maxLength={2000} defaultValue={run?.review ?? ""} /></label>
    <button className="btn btn-primary">Guardar recorrido</button>
  </form>;
}

export default async function SchoolsPage({ searchParams }: { searchParams: Promise<{ fecha?: string; aviso?: string }> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const today = dateOnly(localInput(new Date()).slice(0, 10))!;
  const requested = dateOnly(params.fecha ?? "");
  const next = requested ? null : await prisma.schoolRun.findFirst({ where: { serviceDate: { gte: today } }, orderBy: { serviceDate: "asc" }, select: { serviceDate: true } });
  const day = requested ?? next?.serviceDate ?? today;
  const date = day.toISOString().slice(0, 10);
  const runs = await prisma.schoolRun.findMany({ where: { serviceDate: day }, orderBy: [{ routeName: "asc" }, { id: "asc" }], include: { driver: { select: { name: true } }, vehicle: { select: { name: true } } } });
  const [drivers, vehicles, days] = await Promise.all([
    prisma.user.findMany({ where: { OR: [{ role: "DRIVER", isActive: true }, { id: { in: runs.flatMap(r => r.driverId ? [r.driverId] : []) } }] }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.vehicle.findMany({ where: { OR: [{ isActive: true }, { id: { in: runs.flatMap(r => r.vehicleId ? [r.vehicleId] : []) } }] }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.schoolRun.groupBy({ by: ["serviceDate"], where: { serviceDate: { gte: new Date(+day - 7*86400000), lte: new Date(+day + 7*86400000) } }, orderBy: { serviceDate: "asc" } })
  ]);
  return <AdminShell title="Escolares" eyebrow="Operación" role={user.role} notice={params.aviso}>
    <div className="school-toolbar"><form><label>Fecha de servicio <input name="fecha" type="date" defaultValue={date} required /></label> <button className="btn">Ver día</button></form>
    <details><summary>Nuevo recorrido</summary><RunForm {...{ date, drivers, vehicles }} /></details></div>
    <nav className="school-days" aria-label="Días con recorridos">{days.map(({ serviceDate }) => {
      const iso = serviceDate.toISOString().slice(0, 10);
      return <a key={iso} aria-current={iso === date ? "date" : undefined} href={"?fecha=" + iso}>{serviceDate.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" })}</a>;
    })}</nav>
    <h2>{runs.length} {runs.length === 1 ? "recorrido" : "recorridos"} · {day.toLocaleDateString("es-AR", {dateStyle:"long",timeZone:"UTC"})}</h2>
    {runs.map(run => {
      const source = run.source && typeof run.source === "object" && !Array.isArray(run.source) ? run.source : null;
      const pending = !run.driverId || !run.vehicleId || !!run.review;
      return <details className="school-run" key={run.id}><summary>
        <strong>{run.routeName}</strong><span>{run.shift}</span><span>{run.driver?.name ?? "Chofer pendiente"} · {run.vehicle?.name ?? "Nave pendiente"}</span>
        {pending && <small>Revisar</small>}</summary>
        {source && <p>Planilla · hoja {String(source.sheet)} · fila {String(source.row)} · chofer {String(source.driver || "sin dato")} · nave {String(source.vehicle || "sin dato")}</p>}
        <RunForm {...{ run, date, drivers, vehicles }} />
      </details>;
    })}
  </AdminShell>;
}
