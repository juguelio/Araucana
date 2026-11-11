import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { AirportAddressMap } from "@/components/airport-address-map";
import type { PickupPoint } from "@/lib/airport/pickup-zone";
import { airportPickupStart } from "@/lib/airport/pickup-start";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { getReservationByCode } from "@/lib/booking/repository";
import { canRegisterManualPayment } from "@/lib/booking/admin-price";
import { DISABILITY_DOCUMENT_PROVIDER } from "@/lib/booking/disability-fare";
import { manageReservationAction } from "../actions";
import { ConfirmReservationButton } from "./confirm-reservation-button";

type AdminPassengerPageProps = {
  searchParams: Promise<{ notice?: string }>;
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

export default async function AdminPassengerPage({ params, searchParams }: AdminPassengerPageProps) {
  const user = await getCurrentReservationsUserOrRedirect();
  const { code } = await params;
  const { notice } = await searchParams;
  const reservation = await getReservationByCode(code.toUpperCase());

  if (!reservation) {
    notFound();
  }

  const passengerName = `${reservation.passenger.firstName} ${reservation.passenger.lastName}`;
  const isChapelco = reservation.bookingMode === "CHAPELCO";
  const airport = reservation.bookingMode === "AIRPORT" ? reservation.airportDetails : null;
  const pickupStart = airport?.flight && reservation.status !== "CANCELLED" ? airportPickupStart({ ...airport.flight, direction: airport.direction }) : null;

  const payment = reservation.payment;
  const disability = payment?.provider === DISABILITY_DOCUMENT_PROVIDER || reservation.status === "DOCUMENTATION_PENDING";
  const paid = payment?.status === "APPROVED" && !disability;
  const cancelled = reservation.status === "CANCELLED";
  const pending = reservation.status === "PENDING_PAYMENT";
  const canRecordPayment = canRegisterManualPayment(reservation.status, reservation.totalCents, payment);
  const total = new Intl.NumberFormat("es-AR", { style: "currency", currency: reservation.currency }).format(reservation.total);
  const pickupDetails = airport ?? reservation.chapelcoDetails;
  const pickupPoint: PickupPoint | null = pickupDetails?.pickupLatitude != null && pickupDetails.pickupLongitude != null
    ? [pickupDetails.pickupLatitude, pickupDetails.pickupLongitude] : null;
  const detailPath = `/admin/reservas/${reservation.code}`;

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

      {notice ? <p className="plain-card" role="status">{notice}</p> : null}

      <section className="plain-card admin-section">
        <h2>Gestionar reserva</h2>
        <p>{disability ? "Tarifa por discapacidad" : `Total: ${total} · ${paid ? "Pago registrado" : "Sin pago registrado"}`}</p>
        {payment?.method && paid ? <p className="muted">Forma de pago: {payment.method}</p> : null}
        {payment?.externalRef && paid ? <p className="muted">Referencia: {payment.externalRef}</p> : null}
        <div className="form-actions">
          <Link className="ghost-button" href={`${detailPath}/editar`}>Editar reserva</Link>
          {pending && !disability ? (
            <form action={manageReservationAction}>
              <input type="hidden" name="code" value={reservation.code} />
              <input type="hidden" name="operation" value="confirm" />
              <button className="primary-button" type="submit" disabled={!paid && reservation.totalCents > 0}>Confirmar reserva</button>
            </form>
          ) : null}
          {!cancelled ? (
            <form action={manageReservationAction}>
              <input type="hidden" name="code" value={reservation.code} />
              <ConfirmReservationButton operation="cancel" />
            </form>
          ) : null}
          {user.role === "ADMIN" && !paid ? (
            <form action={manageReservationAction}>
              <input type="hidden" name="code" value={reservation.code} />
              <ConfirmReservationButton operation="delete" />
            </form>
          ) : null}
          {canRecordPayment ? <Link className="ghost-button" href={`${detailPath}/pago`}>Registrar pago</Link> : null}
        </div>
      </section>

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
            {airport ? (
              <div>
                <span>Número de vuelo</span>
                <strong>
                  {airport.flightNumber} ·{" "}
                  {airport.direction === "ARRIVAL" ? "llegada a CPC" : "salida de CPC"}
                </strong>
              </div>
            ) : null}
            <div>
              <span>{airport ? "Horario del vuelo" : isChapelco ? "Fecha" : "Salida"}</span>
              <strong>
                {isChapelco && reservation.chapelcoDetails
                  ? `${formatDateTime(reservation.chapelcoDetails.serviceDate)} · ${reservation.chapelcoDetails.ascentSlot}`
                  : formatDateTime(reservation.schedule.departureAt)}
              </strong>
            </div>
            {pickupStart ? <div><span>{airport?.flight?.pickupStartOverrideAt ? "Inicio de recorrida" : "Inicio estimado de recorrida"}</span><strong>{formatDateTime(pickupStart)}</strong></div> : null}
            <div>
              <span>{isChapelco ? "Cupo" : "Asiento"}</span>
              <strong>{`${reservation.passengerCount} ${reservation.passengerCount === 1 ? "lugar" : "lugares"}`}</strong>
            </div>
            {reservation.halfFareCount ? <div><span>Menores con media tarifa</span><strong>{reservation.halfFareCount}</strong></div> : null}
            {reservation.freeFareCount ? <div><span>Menores de 4 sin cargo</span><strong>{reservation.freeFareCount}</strong></div> : null}
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

      {airport && (airport.pickupAddress?.trim() || pickupPoint) ? (
        <section className="plain-card admin-section">
          <h2>{airport.direction === "ARRIVAL" ? "Dirección de destino" : "Dirección de búsqueda"}</h2>
          {airport.pickupName ? <p><strong>{airport.pickupName}</strong></p> : null}
          <p>{airport.pickupAddress || "Ubicación confirmada en el mapa"}</p>
          {airport.pickupNotes ? <p className="muted">{airport.pickupNotes}</p> : null}
          <AirportAddressMap address={airport.pickupAddress ?? ""} point={pickupPoint} />
        </section>
      ) : null}

    </AdminShell>
  );
}
