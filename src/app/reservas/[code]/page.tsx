import { DISABILITY_DOCUMENT_PROVIDER, receiptPendingStatus } from "@/lib/booking/disability-fare";
import { AIRPORT_PICKUP_COPY, airportPickupStart } from "@/lib/airport/pickup-start";
import { formatDateTime, formatPrice, paymentLabel, statusBadge, statusHeading, statusCopy, statusTone, placesLabel } from "./presentation";
import { requireReservationAccess } from "@/lib/booking/access";
import { AuthorizationError } from "@/lib/auth/service";
import { getManualBankDetails } from "@/lib/payments/manual-bank-details";
import { notFound } from "next/navigation";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { getReservationByCode } from "@/lib/booking/repository";
import { formatShortCode } from "@/lib/booking/codes";
import { absoluteUrl, voucherMessage, voucherPath, whatsappShareUrl } from "@/lib/booking/voucher";
import { siteOrigin } from "@/lib/site-origin";
import { ManualPaymentPanel } from "./manual-payment-panel";
import "./reserva.css";

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
  const airportMapUrl = airport?.pickupLatitude != null && airport.pickupLongitude != null
    ? `https://www.google.com/maps/search/?${new URLSearchParams({
      api: "1", query: `${airport.pickupLatitude},${airport.pickupLongitude}`
    })}`
    : null;
  const pickupStart = airport?.flight && reservation.status !== "CANCELLED" ? airportPickupStart({ ...airport.flight, direction: airport.direction }) : null;
  // Voucher (#166): el pasajero lo abre desde acá y lo puede reenviar por WhatsApp.
  const voucherHref = voucherPath(reservation.code);
  const voucherWhatsApp = whatsappShareUrl(
    reservation.passenger.phone,
    voucherMessage({
      firstName: reservation.passenger.firstName,
      shortCode: formatShortCode(reservation.shortCode),
      url: absoluteUrl(voucherHref, await siteOrigin())
    })
  );

  const departureLabel = isChapelco && reservation.chapelcoDetails
    ? `${formatDateTime(reservation.chapelcoDetails.serviceDate)} · ${reservation.chapelcoDetails.ascentSlot}`
    : formatDateTime(reservation.schedule.departureAt);
  // El título del traslado sale del sentido del vuelo: la ruta guardada es una sola para ida y vuelta,
  // así que «Aeropuerto Chapelco - San Martín» podía quedar al revés para quien se va.
  const tripTitle = airport
    ? airport.direction === "ARRIVAL" ? "Traslado desde el Aeropuerto Chapelco" : "Traslado al Aeropuerto Chapelco"
    : `${reservation.route.from} → ${reservation.dropoffStop ?? reservation.route.to}`;
  const showPaymentPanel = Boolean(reservation.payment && reservation.status === receiptPendingStatus(reservation.payment.provider) && ["PENDING", "REJECTED"].includes(reservation.payment.status));
  const receiptRejected = reservation.payment?.status === "REJECTED" && reservation.status === "PENDING_PAYMENT";
  const paymentText = disabilityFare ? "Sin cargo" : paymentLabel(reservation.payment?.status);
  const paymentTone = disabilityFare || reservation.payment?.status === "APPROVED" ? "ok" : reservation.payment?.status === "REJECTED" ? "grave" : "atencion";
  const [headingMain, headingRest] = statusHeading(reservation.status).split(" · ");
  const ticketPendingNote = !reservation.ticket && !airport && !isChapelco && reservation.status !== "CANCELLED";

  return (
    <>
      <main className="page-shell section reserva-pasajero">
        {/* Antes: «Reserva recibida» dos veces (arriba en chico y enorme abajo), el estado del pago en
            inglés («Pending») y una tarjeta de ticket casi vacía con «QR payload». Ahora: estado,
            código, lo esencial y qué sigue, arriba; el detalle en dos tarjetas. */}
        <section className="plain-card rp-hero">
          <div className="rp-hero-main">
            <p className="rp-hero-top">
              <span className="eyebrow">Tu reserva</span>
              {/* El título dice «Reserva recibida» y la etiqueta de color el resto, sin repetirlo. */}
              {headingRest ? <span className="pill pill-estado" data-tono={statusTone(reservation.status)}>{statusBadge(reservation.status)}</span> : null}
            </p>
            <h1 className="section-title rp-title">{headingMain}</h1>
            <p className="lead rp-lead">{statusCopy(reservation.status)}</p>
            <dl className="rp-facts">
              <div><dt>{airport ? "Vuelo" : isChapelco ? "Fecha" : "Salida"}</dt><dd>{departureLabel}</dd></div>
              <div><dt>{isChapelco ? "Cupo" : "Lugares"}</dt><dd>{placesLabel(reservation.passengerCount)}</dd></div>
              <div><dt>Total</dt><dd>{formatPrice(reservation.totalCents, reservation.currency)}</dd></div>
            </dl>
            {showPaymentPanel ? (
              <a className="button rp-hero-cta" href="#pago">{disabilityFare ? "Subir el comprobante" : receiptRejected ? "Enviar un comprobante nuevo" : "Ver cómo pagar"}</a>
            ) : null}
          </div>
          <div className="ticket-code rp-code">
            <span>Código de reserva</span>
            <strong>{formatShortCode(reservation.shortCode)}</strong>
            <span className="ticket-code-note">Usalo si nos escribís por tu reserva.</span>
            <span className="ticket-code-note rp-link-code">Código del link privado: {reservation.code}</span>
          </div>
        </section>

        <section className="plain-card voucher-cta rp-voucher">
          <div>
            <p className="eyebrow">Voucher</p>
            <p>Tu comprobante para presentar en el viaje, con las políticas de cancelación. Podés mostrarlo desde el celular o imprimirlo.</p>
          </div>
          <div className="form-actions">
            <Link className="ghost-button" href={voucherHref}>Ver voucher</Link>
            {voucherWhatsApp ? (
              <a className="ghost-button" href={voucherWhatsApp} target="_blank" rel="noopener noreferrer">Compartir por WhatsApp</a>
            ) : null}
          </div>
        </section>

        <section className="rp-layout">
          <div className="plain-card rp-card">
            <p className="eyebrow">Tu viaje</p>
            <h2 className="route-title">{tripTitle}</h2>
            <dl className="rp-list">
              {airport ? (
                <div>
                  <dt>Vuelo</dt>
                  <dd>{airport.flightNumber} · {airport.direction === "ARRIVAL" ? "llega a Chapelco (CPC)" : "sale de Chapelco (CPC)"}</dd>
                </div>
              ) : null}
              <div>
                <dt>{airport ? "Horario del vuelo" : isChapelco ? "Fecha" : "Salida"}</dt>
                <dd>{departureLabel}</dd>
              </div>
              {airport && (airport.pickupAddress || airportMapUrl) ? (
                <div>
                  <dt>{airport.direction === "ARRIVAL" ? "Dirección de destino" : "Dirección de búsqueda"}</dt>
                  {airport.pickupAddress ? <dd>{airport.pickupAddress}</dd> : null}
                  {airportMapUrl ? <dd><a className="ghost-button rp-map" href={airportMapUrl} target="_blank" rel="noreferrer">Ver punto en el mapa</a></dd> : null}
                </div>
              ) : null}
              {isChapelco && reservation.chapelcoDetails ? (
                <div>
                  <dt>Búsqueda</dt>
                  <dd>{reservation.chapelcoDetails.pickupName} · {reservation.chapelcoDetails.pickupAddress}</dd>
                </div>
              ) : null}
              {isChapelco && reservation.chapelcoDetails?.pickupNotes ? (
                <div>
                  <dt>Observaciones</dt>
                  <dd>{reservation.chapelcoDetails.pickupNotes}</dd>
                </div>
              ) : null}
              {/* «Regreso: Segun ruta» no decía nada en un traslado al aeropuerto; ahí no se muestra. */}
              {!airport ? (
                <div>
                  <dt>Regreso</dt>
                  <dd>{isChapelco ? "Incluido desde las 17:00" : "Según la ruta"}</dd>
                </div>
              ) : null}
            </dl>
            {pickupStart ? (
              <div className="rp-pickup">
                <span>{airport?.flight?.pickupStartOverrideAt ? "Inicio de recorrida" : "Inicio estimado de recorrida"}</span>
                <strong>{formatDateTime(pickupStart)}</strong>
                <p>{AIRPORT_PICKUP_COPY}</p>
              </div>
            ) : null}
          </div>

          <div className="plain-card rp-card">
            <p className="eyebrow">{isChapelco ? "Responsable y pago" : "Pasajeros y pago"}</p>
            <h2 className="route-title">{passengerName}</h2>
            <dl className="rp-list">
              <div>
                <dt>Documento</dt>
                <dd>{reservation.passenger.documentType} {reservation.passenger.documentId}</dd>
              </div>
              {reservation.passenger.email ? (
                <div><dt>Email</dt><dd className="rp-break">{reservation.passenger.email}</dd></div>
              ) : null}
              <div>
                <dt>{isChapelco ? "Cupo" : "Lugares"}</dt>
                <dd>{placesLabel(reservation.passengerCount)}</dd>
              </div>
              {reservation.halfFareCount ? (
                <div><dt>Menores con media tarifa</dt><dd>{reservation.halfFareCount}</dd></div>
              ) : null}
              {reservation.freeFareCount ? (
                <div><dt>Menores de 4 sin cargo</dt><dd>{reservation.freeFareCount}</dd></div>
              ) : null}
              {airport?.sportsLuggageCount ? (
                <div><dt>Equipaje deportivo</dt><dd>{airport.sportsLuggageCount} {airport.sportsLuggageCount === 1 ? "bulto" : "bultos"} · {formatPrice(airport.sportsLuggageCount * (airport.sportsLuggageUnitCents ?? 0), reservation.currency)}</dd></div>
              ) : null}
              {airport?.zoneExtraCents ? (
                <div><dt>Recargo por zona</dt><dd>{formatPrice(airport.zoneExtraCents, reservation.currency)}</dd></div>
              ) : null}
              <div>
                <dt>Estado de pago</dt>
                <dd><span className="pill pill-estado" data-tono={paymentTone}>{paymentText}</span></dd>
              </div>
            </dl>
            <div className="rp-total">
              <span>Total</span>
              <strong>{formatPrice(reservation.totalCents, reservation.currency)}</strong>
            </div>
            {ticketPendingNote ? <p className="muted rp-note">El ticket se emite cuando se confirma el pago.</p> : null}
          </div>
        </section>

        {/* El ticket sólo aparece cuando existe; el contenido técnico del QR queda plegado. */}
        {reservation.ticket ? (
          <section className="plain-card rp-ticket">
            <div>
              <p className="eyebrow">Ticket</p>
              <h2 className="route-title">{reservation.ticket.code}</h2>
            </div>
            <details className="qr-payload">
              <summary>Datos del ticket para el control</summary>
              <code>{reservation.ticket.qrPayload}</code>
            </details>
          </section>
        ) : null}

        {receiptRejected ? <p className="page-shell error" role="status">El comprobante fue rechazado. Revisá los datos del pago y enviá un comprobante nuevo, o contactá al equipo de Araucana.</p> : null}
        {disabilityFare && reservation.payment?.status === "REJECTED" && <p className="page-shell error" role="status">No pudimos aprobar el comprobante. Podés subir uno nuevo para que administración lo revise.</p>}
        {showPaymentPanel && reservation.payment ? (
          <div id="pago" className="rp-pago">
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
          </div>
        ) : null}
      </main>
      <SiteFooter />
    </>
  );
}
