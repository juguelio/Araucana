import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { ConcesionesNav } from "@/components/concesiones-nav";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { etiquetaDeConcesion, normalizarTipoDeConcesion } from "@/lib/school-runs/kinds";
import "../escolares.css";

export default async function SchoolDetail({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ aviso?: string }>
}) {
  const user = await getCurrentReservationsUserOrRedirect();
  const { id } = await params;
  const run = await prisma.schoolRun.findUnique({ where: { id }, include: {
    driver: { select: { name: true, email: true } }, vehicle: { select: { name: true } }
  } });
  if (!run) notFound();
  const date = run.serviceDate.toISOString().slice(0, 10);
  const source = run.source && typeof run.source === "object" && !Array.isArray(run.source) ? run.source : null;
  const tipo = normalizarTipoDeConcesion(run.kind);
  const fields = [
    ["Tipo", etiquetaDeConcesion(tipo)],
    ["Fecha", run.serviceDate.toLocaleDateString("es-AR", { dateStyle: "long", timeZone: "UTC" })],
    ["Turno u horario", run.shift], ["Chofer", run.driver?.name ?? run.driver?.email ?? "Sin asignar"],
    ["Nave", run.vehicle?.name ?? "Sin asignar"], ["Segunda persona", run.companion ?? "Sin asignar"],
    ["Observaciones", run.notes ?? "—"], ["Pendiente de revisión", run.review ?? "—"]
  ];
  return <AdminShell title={run.routeName} eyebrow={`Concesiones · ${etiquetaDeConcesion(tipo)}`} role={user.role} notice={(await searchParams).aviso}
    action={<div className="inline-actions"><Link className="ghost-button" href={`/admin/escolares?fecha=${date}&tipo=${tipo}`}>Volver al listado</Link><Link className="button" href={`/admin/escolares/${id}/editar`}>Editar servicio</Link></div>}>
    <ConcesionesNav actual={tipo} fecha={date} />
    <section className="plain-card admin-section"><dl className="school-facts">{fields.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
    {source && <section className="plain-card admin-section"><h2>Planilla de origen</h2><p>Hoja {String(source.sheet)} · Fila {String(source.row)}</p>
      <p className="muted">Chofer {String(source.driver || "sin dato")} · Nave {String(source.vehicle || "sin dato")}</p></section>}
  </AdminShell>;
}
