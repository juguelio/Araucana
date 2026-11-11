import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { billingModes, legSchema, localInput, paymentSchema, statuses } from "@/lib/special-trips/data";

const dateFormat = new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "UTC" });

export default async function TripPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ guardado?: string }> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const [{ id }, { guardado }] = await Promise.all([params, searchParams]);
  const trip = await prisma.specialTrip.findUnique({
    where: { id },
    include: {
      assignments: {
        orderBy: { startsAt: "asc" },
        include: { vehicle: { select: { name: true } }, driver: { select: { name: true, email: true } } }
      },
      sources: { orderBy: [{ sheet: "asc" }, { row: "asc" }] }
    }
  });
  if (!trip) notFound();
  const legs = z.array(legSchema).safeParse(trip.legs).data ?? [];
  const payments = z.array(paymentSchema).safeParse(trip.payments).data ?? [];
  const total = trip.totalCents === null ? "Por confirmar"
    : new Intl.NumberFormat("es-AR", { style: "currency", currency: trip.currency }).format(trip.totalCents / 100);

  return (
    <AdminShell title={trip.client} eyebrow="Viaje especial" role={user.role} notice={guardado ? "Viaje guardado." : undefined}
      action={<div className="inline-actions">
        <Link className="ghost-button" href="/admin/viajes-especiales">Volver a Viajes especiales</Link>
        <Link className="button" href={`/admin/viajes-especiales/${id}/editar`}>Editar viaje</Link>
      </div>}>
      <section className="plain-card admin-section">
        <h2>Datos del viaje</h2>
        <p>{dateFormat.format(trip.serviceDate)} · {statuses[trip.status as keyof typeof statuses] ?? trip.status}</p>
        {trip.contact ? <p>Contacto {trip.contact}</p> : null}
        {trip.passengers !== null ? <p>{trip.passengers} pasajeros</p> : null}
        {trip.notes ? <p>{trip.notes}</p> : null}
      </section>
      <section className="plain-card admin-section">
        <h2>Itinerario</h2>
        {legs.length ? legs.map((leg, index) => (
          <div key={index}>
            <h3>{[leg.origin, leg.destination].filter(Boolean).join(" → ") || `Tramo ${index + 1}`}</h3>
            {leg.departure ? <p>Salida {leg.departure.replace("T", " ")}</p> : null}
            {leg.arrival ? <p>Llegada {leg.arrival.replace("T", " ")}</p> : null}
            {leg.stops ? <p>Paradas {leg.stops}</p> : null}
            {leg.description ? <p>{leg.description}</p> : null}
          </div>
        )) : <p>{trip.destinationSearch.replaceAll("\n", " · ") || "Sin itinerario cargado."}</p>}
      </section>
      <section className="plain-card admin-section">
        <h2>Naves y choferes</h2>
        {trip.assignments.length ? <ul>{trip.assignments.map((assignment) => (
          <li key={assignment.id}>
            {assignment.vehicle.name} · {assignment.driver?.name ?? assignment.driver?.email ?? "Sin chofer"} ·{" "}
            {localInput(assignment.startsAt).replace("T", " ")} a {localInput(assignment.endsAt).replace("T", " ")}
          </li>
        ))}</ul> : <p>Sin nave asignada.</p>}
      </section>
      <section className="plain-card admin-section">
        <h2>Facturación</h2>
        <p>{billingModes[trip.billingMode as keyof typeof billingModes] ?? trip.billingMode} · {total}</p>
        {trip.paymentStatus ? <p>{trip.paymentStatus}</p> : null}
        {trip.supplier ? <p>Proveedor {trip.supplier}</p> : null}
        {trip.invoice ? <p>Factura {trip.invoice}{trip.invoiceDate ? ` · ${dateFormat.format(trip.invoiceDate)}` : ""}</p> : null}
        {payments.length ? <ul>{payments.map((payment, index) => (
          <li key={index}>{[payment.date, payment.amount, payment.note].filter(Boolean).join(" · ")}</li>
        ))}</ul> : null}
      </section>
      {trip.sources.length > 0 ? <section className="plain-card admin-section">
        <h2>Filas de origen</h2>
        {trip.sources.map((source) => <details key={source.id}>
          <summary>{source.sheet} · fila {source.row}</summary>
          {Array.isArray(source.issues) && source.issues.map((issue, index) => <p key={index}>{String(issue)}</p>)}
          {Array.isArray(source.original) && <p>{source.original.map((cell) => String(cell ?? "")).join(" · ")}</p>}
        </details>)}
      </section> : null}
    </AdminShell>
  );
}
