import { DISABILITY_DOCUMENT_PROVIDER, receiptPendingStatus } from "@/lib/booking/disability-fare";
import { AIRPORT_PICKUP_COPY, airportPickupStart } from "@/lib/airport/pickup-start";
import { formatDateTime, formatPrice, paymentLabel, statusHeading, statusCopy, placesLabel } from "./presentation";
import { requireReservationAccess } from "@/lib/booking/access";
import { AuthorizationError } from "@/lib/auth/service";
import { getManualBankDetails } from "@/lib/payments/manual-bank-details";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { getReservationByCode } from "@/lib/booking/repository";
import { ManualPaymentPanel } from "./manual-payment-panel";

export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export const dynamic = "force-dynamic";

type ReservationConfirmationPageProps = {
  params: Promise<{
    code: string;
  }>;
};

export default async function ReservationConfirmationPage({ params }: ReservationConfirmationPageProps) {
  const { code } = await params;
  try {
    await requireReservationAccess(code.toUpperCase());
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return <main className="page-shell section"><h1>Reserva privada</h1><p>Para consultar una reserva anterior, contactá al equipo de Araucana con tu código.</p><a href="/soporte">Contactar al equipo</a></main>;
  }
  const reservation = await getReservationByCode(code.toUpperCase());

  if (!reservation) {
    notFound();
  }

  const passengerName = `${reservation.passenger.firstName} ${reservation.passenger.lastName}`;
  const disabilityFare = reservation.payment?.provider === DISABILITY_DOCUMENT_PROVIDER;
  const isChapelco = reservation.bookingMode === "CHAPELCO";
  const airport = reservation.airportDetails;
  const pickupStart = airport?.flight && reservation.status !== "CANCELLED" ? airportPickupStart({ ...airport.flight, direction: airport.direction }) : null;

  return (
    <>
      <main className="page-shell section">
        <section className="ticket-hero plain-card">
          <div>
            <p className="eyebrow">Reserva recibida</p>
            <h1 className="section-title">{statusHeading(reservation.status)}</h1>
            <p className="lead">{statusCopy(reservation.status)}</p>
          </div>
          <div className="ticket-code">
            <span>Codigo de reserva</span>
            <strong>{reservation.code}</strong>
          </div>
        </section>

        <section className="ticket-layout">
          <div className="plain-card ticket-summary">
            <p className="eyebrow">Detalle</p>
            <h2 className="route-title">
              {reservation.route.from} - {reservation.dropoffStop ?? reservation.route.to}
            </h2>
            <div className="summary-list">
              <div>
                <span>{airport ? "Horario del vuelo" : isChapelco ? "Fecha" : "Salida"}</span>
                <strong>
                  {isChapelco && reservation.chapelcoDetails
                    ? `${formatDateTime(reservation.chapelcoDetails.serviceDate)} · ${reservation.chapelcoDetails.ascentSlot}`
                    : formatDateTime(reservation.schedule.departureAt)}
                </strong>
              </div>
              {reservation.airportDetails ? (
                <div>
                  <span>Vuelo</span>
                  <strong>
                    {reservation.airportDetails.flightNumber} ·{" "}
                    {reservation.airportDetails.direction === "ARRIVAL" ? "llegada a CPC" : "salida de CPC"}
                  </strong>
                </div>
              ) : null}
              {pickupStart ? (
                <div>
                  <span>{airport?.flight?.pickupStartOverrideAt ? "Inicio de recorrida" : "Inicio estimado de recorrida"}</span>
                  <strong>{formatDateTime(pickupStart)}</strong>
                  <p className="muted">{AIRPORT_PICKUP_COPY}</p>
                </div>
              ) : null}
              <div>
                <span>{isChapelco ? "Responsable" : "Pasajero"}</span>
                <strong>{passengerName}</strong>
              </div>
              <div>
                <span>{isChapelco ? "Cupo" : "Lugares"}</span>
                <strong>{placesLabel(reservation.passengerCount)}</strong>
              </div>
              {isChapelco && reservation.chapelcoDetails ? (
                <div>
                  <span>Busqueda</span>
                  <strong>
                    {reservation.chapelcoDetails.pickupName} · {reservation.chapelcoDetails.pickupAddress}
                  </strong>
                </div>
              ) : null}
              {isChapelco && reservation.chapelcoDetails?.pickupNotes ? (
                <div>
                  <span>Observaciones</span>
                  <strong>{reservation.chapelcoDetails.pickupNotes}</strong>
                </div>
              ) : null}
              <div>
                <span>Regreso</span>
                <strong>{isChapelco ? "Incluido desde las 17:00" : "Segun ruta"}</strong>
              </div>
              <div>
                <span>Estado de pago</span>
                <strong>{disabilityFare ? "Sin cargo" : paymentLabel(reservation.payment?.status)}</strong>
              </div>
              <div>
                <span>Total</span>
                <strong>{formatPrice(reservation.totalCents, reservation.currency)}</strong>
              </div>
            </div>
          </div>

          <div className="plain-card ticket-summary">
            <p className="eyebrow">Ticket</p>
            <h2 className="route-title">{reservation.ticket?.code ?? "Ticket pendiente"}</h2>
            <div className="summary-list">
              <div>
                <span>Codigo de ticket</span>
                <strong>{reservation.ticket?.code ?? "Pendiente"}</strong>
              </div>
              <div>
                <span>Documento</span>
                <strong>
                  {reservation.passenger.documentType} {reservation.passenger.documentId}
                </strong>
              </div>
              <div>
                <span>Email</span>
                <strong>{reservation.passenger.email}</strong>
              </div>
            </div>
            <div className="qr-payload">
              <span>QR payload</span>
              <code>{reservation.ticket?.qrPayload ?? "Pendiente de emision"}</code>
            </div>
          </div>
        </section>

        {reservation.payment?.status === "REJECTED" && reservation.status === "PENDING_PAYMENT" ? <p className="page-shell error" role="status">El comprobante fue rechazado. Revisá los datos del pago y enviá un comprobante nuevo, o contactá al equipo de Araucana.</p> : null}
        {disabilityFare && reservation.payment?.status === "REJECTED" && <p className="page-shell error" role="status">No pudimos aprobar el comprobante. Podés subir uno nuevo para que administración lo revise.</p>}
        {reservation.payment && reservation.status === receiptPendingStatus(reservation.payment.provider) && ["PENDING", "REJECTED"].includes(reservation.payment.status) ? (
          <ManualPaymentPanel
            reservationCode={reservation.code}
            disabilityDocument={disabilityFare}
            bankDetails={disabilityFare ? null : getManualBankDetails()}
            receiptUploadEnabled={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
            existingReceipt={{
              fileName: reservation.payment.receiptFileName ?? null,
              uploadedAt: reservation.payment.receiptUploadedAt ?? null
            }}
          />
        ) : null}
      </main>
      <SiteFooter />
    </>
  );
}
