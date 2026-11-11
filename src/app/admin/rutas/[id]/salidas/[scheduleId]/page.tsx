import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";

type RouteSchedulePageProps = {
  params: Promise<{ id: string; scheduleId: string }>;
  searchParams?: Promise<{ notice?: string }>;
};

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "America/Argentina/Salta"
});

const timeFormatter = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Salta"
});

function reservationStatus(status: string) {
  return {
    CONFIRMED: "Confirmada",
    PENDING_PAYMENT: "Pago pendiente",
    CANCELLED: "Cancelada"
  }[status] ?? status;
}

function whatsappHref(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

export default async function RouteSchedulePage({ params, searchParams }: RouteSchedulePageProps) {
  await getCurrentAdminOrRedirect();
  const [{ id: routeId, scheduleId }, query] = await Promise.all([params, searchParams]);
  const [schedule, reservations] = await Promise.all([
    prisma.schedule.findFirst({ where: { id: scheduleId, routeId }, include: { route: true, vehicle: { select: { name: true } } } }),
    prisma.reservation.findMany({
      where: { scheduleId },
      include: {
        passenger: true,
        payment: { select: { status: true } }
      },
      orderBy: { createdAt: "asc" }
    })
  ]);

  if (!schedule) {
    notFound();
  }

  const status = { OPEN: "Abierta", DOCUMENTATION: "Documentación", CLOSED: "Cerrada" }[schedule.status] ?? schedule.status;
  return (
    <AdminShell title={`${schedule.route.from} → ${schedule.route.to}`} eyebrow="Salida" notice={query?.notice}
      action={<div className="inline-actions">
        <Link className="ghost-button" href={`/admin/rutas/${routeId}/salidas`}>Volver a salidas</Link>
        <Link className="button" href={`/admin/rutas/${routeId}/salidas/${scheduleId}/editar`}>Editar salida</Link>
      </div>}>
      <section className="plain-card admin-section">
        <h2>Datos de la salida</h2>
        <div className="summary-list">
          <div><span>Nave</span><strong>{schedule.vehicle.name}</strong></div>
          <div><span>Estado</span><strong>{status}</strong></div>
        </div>
      </section>
      <section className="plain-card admin-section schedule-reservations-panel">
        <div className="admin-edit-head">
          <div>
            <p className="eyebrow">Pasajeros asignados</p>
            <h2>Reservas de esta salida</h2>
            <p className="muted">{dateFormatter.format(schedule.departureAt)} · Sale {timeFormatter.format(schedule.departureAt)} · Llega {timeFormatter.format(schedule.arrivalAt)}</p>
          </div>
          <span className="status-pill active">{reservations.length} {reservations.length === 1 ? "reserva" : "reservas"}</span>
        </div>
        {reservations.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Reserva</th><th>Pasajero</th><th>Contacto</th><th>Asiento</th><th>Estado</th><th>Pago</th></tr></thead>
              <tbody>
                {reservations.map((reservation) => {
                  const whatsappUrl = whatsappHref(reservation.passenger.phone);
                  return (
                    <tr key={reservation.id}>
                      <td><Link className="table-link" href={`/admin/reservas/${reservation.code}`}>{reservation.code}</Link></td>
                      <td>{reservation.passenger.firstName} {reservation.passenger.lastName}</td>
                      <td>
                        <div className="reservation-contact"><span>{reservation.passenger.email}</span>{whatsappUrl ? <a href={whatsappUrl} target="_blank" rel="noreferrer">WhatsApp</a> : null}</div>
                      </td>
                      <td><strong>{reservation.passengerCount} {reservation.passengerCount === 1 ? "lugar" : "lugares"}</strong></td>
                      <td><span className={`status-pill ${reservation.status === "CANCELLED" ? "inactive" : "active"}`}>{reservationStatus(reservation.status)}</span></td>
                      <td>{reservation.payment?.status ?? "Pendiente"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="empty-admin-state"><strong>Todavía no hay reservas asignadas.</strong><span>Los pasajeros que reserven esta salida aparecerán acá.</span></div>}
      </section>
    </AdminShell>
  );
}
