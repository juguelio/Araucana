import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { emptyLeg, legSchema, localInput, paymentSchema } from "@/lib/special-trips/data";
import { TripForm } from "../trip-form";

export default async function TripPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ guardado?: string }> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const { id } = await params;
  const { guardado } = await searchParams;
  const trip = id === "nuevo" ? null : await prisma.specialTrip.findUnique({
    where: { id }, include: { assignments: { orderBy: { startsAt: "asc" } }, sources: { orderBy: [{ sheet: "asc" }, { row: "asc" }] } }
  });
  if (!trip && id !== "nuevo") notFound();
  const [vehicles, drivers] = await Promise.all([
    prisma.vehicle.findMany({
      where: { OR: [{ isActive: true, kind: { not: "UTILITARIO" } }, { id: { in: trip?.assignments.map((a) => a.vehicleId) ?? [] } }] },
      orderBy: { name: "asc" }, select: { id: true, name: true }
    }),
    prisma.user.findMany({
      where: { OR: [{ role: "DRIVER", isActive: true }, { id: { in: trip?.assignments.flatMap((a) => a.driverId ?? []) ?? [] } }] },
      orderBy: { name: "asc" }, select: { id: true, name: true, email: true }
    })
  ]);
  return <AdminShell title={trip ? trip.client : "Nuevo viaje especial"} role={user.role} notice={guardado ? "Viaje guardado." : undefined}
    action={<Link className="ghost-button" href="/admin/viajes-especiales">Volver a Viajes especiales</Link>}>
    <TripForm key={trip?.updatedAt.toISOString() ?? "new"} vehicles={vehicles} drivers={drivers.map((d) => ({ id: d.id, name: d.name ?? d.email }))}
      draft={{
        id: trip?.id ?? null, version: trip?.updatedAt.toISOString() ?? null, client: trip?.client ?? "",
        serviceDate: trip?.serviceDate.toISOString().slice(0, 10) ?? localInput(new Date()).slice(0, 10),
        status: trip?.status ?? "PENDING", contact: trip?.contact, passengers: trip?.passengers, notes: trip?.notes,
        legs: trip ? z.array(legSchema).parse(trip.legs) : [emptyLeg],
        assignments: trip?.assignments.map((a) => ({ vehicleId: a.vehicleId, driverId: a.driverId ?? "", start: localInput(a.startsAt), end: localInput(a.endsAt) })) ?? [],
        billingMode: trip?.billingMode ?? "UNKNOWN", currency: trip?.currency ?? "ARS",
        total: trip?.totalCents == null ? "" : (trip.totalCents / 100).toFixed(2),
        payments: trip ? z.array(paymentSchema).parse(trip.payments) : [], supplier: trip?.supplier, invoice: trip?.invoice,
        invoiceDate: trip?.invoiceDate?.toISOString().slice(0, 10), paymentStatus: trip?.paymentStatus
      }} />
    {!!trip?.sources.length && <section className="plain-card admin-section">
      <h2>Filas de origen</h2>
      {trip.sources.map((source) => <details key={source.id}>
        <summary>{source.sheet} · fila {source.row}</summary>
        {Array.isArray(source.issues) && source.issues.map((issue, i) => <p key={i}>{String(issue)}</p>)}
        {Array.isArray(source.original) && <p>{source.original.map((cell) => String(cell ?? "")).join(" · ")}</p>}
      </details>)}
    </section>}
  </AdminShell>;
}
