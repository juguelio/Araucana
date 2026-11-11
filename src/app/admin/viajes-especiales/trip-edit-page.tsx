import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { emptyLeg, legSchema, localInput, paymentSchema } from "@/lib/special-trips/data";
import { TripForm } from "./trip-form";

export async function TripEditPage({ id }: { id?: string }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const trip = id ? await prisma.specialTrip.findUnique({
    where: { id }, include: { assignments: { orderBy: { startsAt: "asc" } } }
  }) : null;
  if (!trip && id) notFound();
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
  return <AdminShell title={trip ? "Editar viaje especial" : "Nuevo viaje especial"} eyebrow={trip?.client} role={user.role}
    action={<Link className="ghost-button" href={trip ? `/admin/viajes-especiales/${trip.id}` : "/admin/viajes-especiales"}>{trip ? "Volver al detalle" : "Volver a Viajes especiales"}</Link>}>
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
  </AdminShell>;
}
