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

export function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "America/Argentina/Salta"
  }).format(new Date(value));
}

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(cents / 100);
}

function paymentLabel(status?: string | null) {
  if (!status) {
    return "Pendiente";
  }

  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function statusHeading(status?: string | null) {
  switch (status) {
    case "CONFIRMED":
    case "PENDING_PAYMENT":
      return "Reserva confirmada";
    case "CANCELLED":
      return "Reserva cancelada";
    default:
      return "Reserva recibida";
  }
}

export function statusCopy(status?: string | null) {
  switch (status) {
    case "CONFIRMED":
      return "Tu reserva esta confirmada. Conserva este enlace privado para presentarlo al equipo de Araucana.";
    case "PENDING_PAYMENT":
      return "Recibimos tu reserva y el pago queda pendiente de confirmacion manual; conserva este enlace privado para coordinar el cierre con el equipo de Araucana.";
    case "CANCELLED":
      return "Esta reserva fue cancelada. Si necesitas revisar el caso, contacta al equipo de Araucana con este codigo.";
    default:
      return "Recibimos tu reserva. Conserva este enlace privado para consultar el estado con el equipo de Araucana.";
  }
}

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
              {reservation.route.from} - {reservation.route.to}
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
              <div>
                <span>{isChapelco ? "Responsable" : "Pasajero"}</span>
                <strong>{passengerName}</strong>
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

        {reservation.payment?.provider === "MANUAL" && reservation.payment.status !== "APPROVED" ? (
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
