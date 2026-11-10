import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { getReservationByCode } from "@/lib/booking/repository";
import { updatePassengerAction } from "../actions";
import { PassengerForm } from "./passenger-form";

type AdminPassengerPageProps = {
  params: Promise<{
    code: string;
  }>;
};

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Argentina/Salta"
  }).format(new Date(value));
}

function formatStatus(status: string) {
  const labels: Record<string, string> = {
    CONFIRMED: "Confirmada",
    PENDING_PAYMENT: "Pago pendiente",
    DOCUMENTATION_PENDING: "Docs pendientes",
    CANCELLED: "Cancelada"
  };

  return labels[status] ?? status;
}

export default async function AdminPassengerPage({ params }: AdminPassengerPageProps) {
  const user = await getCurrentReservationsUserOrRedirect();
  const { code } = await params;
  const reservation = await getReservationByCode(code.toUpperCase());

  if (!reservation) {
    notFound();
  }

  const passengerName = `${reservation.passenger.firstName} ${reservation.passenger.lastName}`;
  const isChapelco = reservation.bookingMode === "CHAPELCO";

  return (
    <AdminShell title={passengerName} role={user.role}>
      <div className="admin-edit-head">
        <div>
          <p className="eyebrow">Pasajero</p>
          <h2 className="section-title">{passengerName}</h2>
        </div>
        <Link className="ghost-button" href="/admin/reservas">
          Volver a reservas
        </Link>
      </div>

      <section className="ticket-layout admin-section">
        <div className="plain-card ticket-summary">
          <p className="eyebrow">Reserva</p>
          <h2 className="route-title">{reservation.code}</h2>
          <div className="summary-list">
            <div>
              <span>Ruta</span>
              <strong>
                {reservation.route.from} - {reservation.dropoffStop ?? reservation.route.to}
              </strong>
            </div>
            <div>
              <span>{isChapelco ? "Fecha" : "Salida"}</span>
              <strong>
                {isChapelco && reservation.chapelcoDetails
                  ? `${formatDateTime(reservation.chapelcoDetails.serviceDate)} · ${reservation.chapelcoDetails.ascentSlot}`
                  : formatDateTime(reservation.schedule.departureAt)}
              </strong>
            </div>
            <div>
              <span>{isChapelco ? "Cupo" : "Asiento"}</span>
              <strong>{`${reservation.passengerCount} ${reservation.passengerCount === 1 ? "lugar" : "lugares"}`}</strong>
            </div>
            {isChapelco && reservation.chapelcoDetails ? (
              <div>
                <span>Busqueda</span>
                <strong>
                  {reservation.chapelcoDetails.pickupName} · {reservation.chapelcoDetails.pickupAddress}
                </strong>
              </div>
            ) : null}
            <div>
              <span>Estado</span>
              <strong>{formatStatus(reservation.status)}</strong>
            </div>
          </div>
        </div>

        <div className="plain-card ticket-summary">
          <p className="eyebrow">Datos actuales</p>
          <h2 className="route-title">Contacto y documento</h2>
          <div className="summary-list">
            <div>
              <span>Email</span>
              <strong>{reservation.passenger.email}</strong>
            </div>
            <div>
              <span>Telefono</span>
              <strong>{reservation.passenger.phone}</strong>
            </div>
            <div>
              <span>Documento</span>
              <strong>
                {reservation.passenger.documentType} {reservation.passenger.documentId}
              </strong>
            </div>
            <div>
              <span>Nacionalidad</span>
              <strong>{reservation.passenger.nationality || "Sin cargar"}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="plain-card admin-section">
        <h2>Editar pasajero</h2>
        <PassengerForm action={updatePassengerAction} reservation={reservation} />
      </section>
    </AdminShell>
  );
}
