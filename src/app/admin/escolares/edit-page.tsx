import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { ConcesionesNav } from "@/components/concesiones-nav";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { dateOnly, localInput } from "@/lib/special-trips/data";
import { etiquetaDeConcesion, normalizarTipoDeConcesion, SCHOOL_RUN_KINDS } from "@/lib/school-runs/kinds";
import { ChoferBuscador } from "../aeropuerto/chofer-buscador";
import { NaveBuscador } from "../aeropuerto/nave-buscador";
import { saveSchoolRun } from "./actions";
import "./escolares.css";

export async function SchoolEditPage({ id, fecha, tipo, aviso }: { id?: string; fecha?: string; tipo?: string; aviso?: string }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const run = id ? await prisma.schoolRun.findUnique({ where: { id } }) : null;
  if (id && !run) notFound();
  const date = run?.serviceDate.toISOString().slice(0, 10) ?? (fecha && dateOnly(fecha) ? fecha : localInput(new Date()).slice(0, 10));
  const kind = normalizarTipoDeConcesion(run?.kind ?? tipo);
  const [drivers, vehicles] = await Promise.all([
    prisma.user.findMany({ where: { OR: [{ role: "DRIVER", isActive: true }, ...(run?.driverId ? [{ id: run.driverId }] : [])] }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } }),
    prisma.vehicle.findMany({ where: { OR: [{ isActive: true }, ...(run?.vehicleId ? [{ id: run.vehicleId }] : [])] }, orderBy: { name: "asc" }, select: { id: true, name: true, internalNumber: true, licensePlate: true } })
  ]);
  // La asignación actual queda a la vista al abrir ambos buscadores.
  drivers.sort((a, b) => Number(b.id === run?.driverId) - Number(a.id === run?.driverId));
  vehicles.sort((a, b) => Number(b.id === run?.vehicleId) - Number(a.id === run?.vehicleId));
  const back = run ? `/admin/escolares/${run.id}` : `/admin/escolares?fecha=${date}&tipo=${kind}`;
  return <AdminShell title={run ? "Editar servicio" : "Nuevo servicio"} eyebrow={`Concesiones · ${etiquetaDeConcesion(kind)}`} role={user.role} notice={aviso}
    action={<Link className="ghost-button" href={back}>{run ? "Volver a la ficha" : "Volver al listado"}</Link>}>
    <ConcesionesNav actual={kind} fecha={date} />
    <form action={saveSchoolRun}>
      <input type="hidden" name="id" value={run?.id ?? randomUUID()} /><input type="hidden" name="revision" value={run?.revision ?? ""} />
      <section className="plain-card admin-section"><h2>Recorrido</h2><div className="admin-form-grid">
        <label className="span-2">Nombre del servicio<input name="routeName" required maxLength={400} defaultValue={run?.routeName} /></label>
        <label>Fecha<input type="date" name="date" required defaultValue={date} /></label>
        <label>Tipo de servicio<select name="kind" defaultValue={kind}>{SCHOOL_RUN_KINDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>Turno u horario<input name="shift" required maxLength={100} defaultValue={run?.shift} /></label>
      </div></section>
      <section className="plain-card admin-section"><h2>Chofer y nave</h2><div className="school-pickers">
        <ChoferBuscador choferes={drivers.map(d => ({ id: d.id, label: d.name ?? d.email, email: d.email }))} flightNumber={run?.routeName ?? "el recorrido"} defaultId={run?.driverId ?? ""} />
        <NaveBuscador naves={vehicles} flightNumber={run?.routeName ?? "el recorrido"} defaultId={run?.vehicleId ?? ""} optional />
      </div><div className="admin-form-grid"><label className="span-2">Segunda persona<input name="companion" maxLength={200} defaultValue={run?.companion ?? ""} /></label></div></section>
      <section className="plain-card admin-section"><h2>Observaciones</h2><div className="admin-form-grid">
        <label className="span-2">Observaciones<textarea name="notes" maxLength={2000} defaultValue={run?.notes ?? ""} /></label>
        <label className="span-2">Pendiente de revisión<textarea name="review" maxLength={2000} defaultValue={run?.review ?? ""} /></label>
      </div></section>
      <div className="inline-actions"><button className="button">Guardar servicio</button><Link className="ghost-button" href={back}>Cancelar</Link></div>
    </form>
  </AdminShell>;
}
