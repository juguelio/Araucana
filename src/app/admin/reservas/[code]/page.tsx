import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { AirportAddressMap } from "@/components/airport-address-map";
import type { PickupPoint } from "@/lib/airport/pickup-zone";
import { airportPickupStart } from "@/lib/airport/pickup-start";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { getAdminReservationByCode } from "@/lib/booking/repository";
import { formatShortCode } from "@/lib/booking/codes";
import { canRegisterManualPayment } from "@/lib/booking/admin-price";
import { DISABILITY_DOCUMENT_PROVIDER, DISABILITY_PENDING_STATUS } from "@/lib/booking/disability-fare";
import {
  approveDisabilityDocumentAction,
  approveManualPaymentAction,
  manageReservationAction,
  rejectDisabilityDocumentAction,
  rejectManualPaymentAction
} from "../actions";
import { ConfirmReservationButton } from "./confirm-reservation-button";
import "./detalle.css";

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

function tonoEstado(status: string) {
  return status === "CONFIRMED" ? "ok" : status === "CANCELLED" ? "normal" : "atencion";
}

function whatsappHref(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
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
  const reservation = await getAdminReservationByCode(code.toUpperCase());

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
  const money = (cents: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: reservation.currency }).format(cents / 100);
  const pickupDetails = airport ?? reservation.chapelcoDetails;
  const pickupPoint: PickupPoint | null = pickupDetails?.pickupLatitude != null && pickupDetails.pickupLongitude != null
    ? [pickupDetails.pickupLatitude, pickupDetails.pickupLongitude] : null;
  const detailPath = `/admin/reservas/${reservation.code}`;
  const whatsappUrl = whatsappHref(reservation.passenger.phone);
  const hasReceipt = Boolean(payment?.receiptBlobPathname);
  const canViewReceipt = !disability || user.role === "ADMIN";
  // Las mismas condiciones que usa el listado para ofrecer «Validar pago» / «Aprobar documentación».
  const receiptReview = hasReceipt && canViewReceipt && payment?.status === "PENDING"
    ? disability
      ? reservation.status === DISABILITY_PENDING_STATUS && payment.receiptUploadedAt ? "documentacion" : null
      : reservation.status === "PENDING_PAYMENT" ? "pago" : null
    : null;
  const pagoTexto = disability ? "Sin cargo" : paid ? "Pago registrado" : payment?.status === "REJECTED" ? "Comprobante rechazado" : hasReceipt ? "Comprobante por validar" : "Sin pago registrado";
  const pagoTono = disability ? "normal" : paid ? "ok" : payment?.status === "REJECTED" ? "grave" : "atencion";

  return (
    <AdminShell title={passengerName} eyebrow={`Reserva ${formatShortCode(reservation.shortCode)}`} role={user.role}>
      {/* Estado y pago arriba de todo: antes el estado estaba al final del resumen y el título se repetía. */}
      <div className="detalle-head">
        <div className="detalle-estado">
          <span className="pill pill-estado" data-tono={tonoEstado(reservation.status)}>{formatStatus(reservation.status)}</span>
          <span className="pill pill-estado" data-tono={pagoTono}>{pagoTexto}</span>
          {!disability ? <span className="detalle-total">{total}</span> : null}
          {reservation.roundTripPartner ? (
            <Link className="pill detalle-tramo" href={`/admin/reservas/${reservation.roundTripPartner.code}`}>
              Ida y vuelta · ver {reservation.roundTripPartner.direction === "ARRIVAL" ? "la llegada" : reservation.roundTripPartner.direction === "DEPARTURE" ? "la vuelta" : "el otro tramo"} →
            </Link>
          ) : null}
        </div>
        <div className="detalle-contacto">
          {whatsappUrl ? (
            <a className="ghost-button detalle-whatsapp" href={whatsappUrl} target="_blank" rel="noopener noreferrer">WhatsApp al pasajero</a>
          ) : null}
          <Link className="ghost-button" href="/admin/reservas">Volver a reservas</Link>
        </div>
      </div>

      {notice ? <p className="plain-card" role="status">{notice}</p> : null}

      {receiptReview ? (
        <section className="plain-card admin-section detalle-revision">
          <h2>{receiptReview === "pago" ? "Comprobante por validar" : "Documentación por revisar"}</h2>
          <p>
            {payment?.receiptFileName ?? "Archivo subido"}
            {payment?.receiptUploadedAt ? ` · subido el ${formatDateTime(payment.receiptUploadedAt)}` : ""}
            {payment?.amountCents ? ` · ${money(payment.amountCents)}` : ""}
          </p>
          <div className="form-actions">
            <Link className="ghost-button" href={`${detailPath}/comprobante`} target="_blank">Ver comprobante</Link>
            {receiptReview === "pago" ? (
              <form action={approveManualPaymentAction} className="detalle-revision-form">
                <input type="hidden" name="code" value={reservation.code} />
                <button className="button" type="submit">Validar pago</button>
                <button className="ghost-button" formAction={rejectManualPaymentAction} type="submit">Rechazar</button>
              </form>
            ) : (
              <form action={approveDisabilityDocumentAction} className="detalle-revision-form">
                <input type="hidden" name="code" value={reservation.code} />
                <input type="hidden" name="receiptVersion" value={new Date(payment!.receiptUploadedAt!).toISOString()} />
                <button className="button" type="submit">Aprobar documentación</button>
                <button className="ghost-button" formAction={rejectDisabilityDocumentAction} type="submit">Rechazar documentación</button>
              </form>
            )}
          </div>
        </section>
      ) : null}

      <section className="plain-card admin-section">
        <h2>Gestionar reserva</h2>
        <p>{disability ? "Tarifa por discapacidad" : `Total: ${total} · ${paid ? "Pago registrado" : "Sin pago registrado"}`}</p>
        {payment?.method && paid ? <p className="muted">Forma de pago: {payment.method}</p> : null}
        {payment?.externalRef && paid ? <p className="muted">Referencia: {payment.externalRef}</p> : null}
        {hasReceipt && canViewReceipt && !receiptReview ? (
          <p className="muted">
            Comprobante: <Link className="table-link" href={`${detailPath}/comprobante`} target="_blank">{payment?.receiptFileName ?? "ver archivo"}</Link>
          </p>
        ) : null}
        <div className="form-actions">
          <Link className="ghost-button" href={`${detailPath}/editar`}>Editar reserva</Link>
          {pending && !disability ? (
            <form action={manageReservationAction}>
              <input type="hidden" name="code" value={reservation.code} />
              <input type="hidden" name="operation" value="confirm" />
              <button className="button" type="submit" disabled={!paid && reservation.totalCents > 0}>Confirmar reserva</button>
            </form>
          ) : null}
          {!cancelled ? (
            <form action={manageReservationAction}>
              <input type="hidden" name="code" value={reservation.code} />
              <ConfirmReservationButton operation="cancel" />
            </form>
          ) : null}
          {cancelled ? (
            <form action={manageReservationAction}>
              <input type="hidden" name="code" value={reservation.code} />
              <input type="hidden" name="operation" value="restore" />
              <button className="button" type="submit">Restituir reserva</button>
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
              <span>Código corto</span>
              <strong>{formatShortCode(reservation.shortCode)}</strong>
            </div>
            <div>
              <span>Creada por</span>
              <strong>{reservation.creatorLabel}</strong>
            </div>
            {reservation.cancellationReason || reservation.cancelledAt ? (
              <div>
                <span>Motivo de la cancelación</span>
                <strong>{reservation.cancellationReason ?? "Sin motivo registrado"}</strong>
              </div>
            ) : null}
            {reservation.cancelledAt ? (
              <div>
                <span>Cancelada</span>
                <strong>
                  {formatDateTime(reservation.cancelledAt)}
                  {reservation.cancelledByName ? ` · ${reservation.cancelledByName}` : ""}
                </strong>
              </div>
            ) : null}
            {reservation.restoredAt ? (
              <div>
                <span>Restituida</span>
                <strong>
                  {formatDateTime(reservation.restoredAt)}
                  {reservation.restoredByName ? ` · ${reservation.restoredByName}` : ""}
                </strong>
              </div>
            ) : null}
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
            {airport?.sportsLuggageCount ? <div><span>Equipaje deportivo</span><strong>{airport.sportsLuggageCount} {airport.sportsLuggageCount === 1 ? "bulto" : "bultos"} · {money(airport.sportsLuggageCount * (airport.sportsLuggageUnitCents ?? 0))}</strong></div> : null}
            {airport?.zoneExtraCents ? <div><span>Recargo por zona</span><strong>{money(airport.zoneExtraCents)}</strong></div> : null}
            {isChapelco && reservation.chapelcoDetails ? (
              <div>
                <span>Búsqueda</span>
                <strong>
                  {reservation.chapelcoDetails.pickupName} · {reservation.chapelcoDetails.pickupAddress}
                </strong>
              </div>
            ) : null}
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
              <span>Teléfono</span>
              <strong>
                {whatsappUrl ? <a className="table-link" href={whatsappUrl} target="_blank" rel="noopener noreferrer">{reservation.passenger.phone}</a> : reservation.passenger.phone}
              </strong>
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
