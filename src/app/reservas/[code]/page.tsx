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
  const isChapelco = reservation.bookingMode === "CHAPELCO";

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
                <span>{isChapelco ? "Fecha" : "Salida"}</span>
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
                <strong>{paymentLabel(reservation.payment?.status)}</strong>
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
        {reservation.status === "PENDING_PAYMENT" && reservation.payment?.provider === "MANUAL" && ["PENDING", "REJECTED"].includes(reservation.payment.status) ? (
          <ManualPaymentPanel
            reservationCode={reservation.code}
            bankDetails={getManualBankDetails()}
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
