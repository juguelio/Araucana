import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { initialAirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { getAirportExtras } from "@/lib/airport/extras-settings";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { canCorrectManualPayment, canEditReservationTotal, canRegisterManualPayment } from "@/lib/booking/admin-price";
import { getReservationByCode } from "@/lib/booking/repository";
import { DISABILITY_DOCUMENT_PROVIDER } from "@/lib/booking/disability-fare";
import { politicaDeComprobante } from "@/lib/payments/receipt-policy";
import { tarifaPorPersona } from "@/lib/booking/reservation-edit";
import { isAdminRole } from "@/lib/auth/roles";
import { manageReservationAction, updateReservationAction } from "../../actions";
import { ConfirmReservationButton } from "../confirm-reservation-button";
import { ReservationEditForm } from "../reservation-edit-form";
import { serviceMoveFor } from "./service-options";
import { RegistrarPagoForm } from "../registrar-pago-form";
import { ReceiptUploadForm } from "../../receipt-upload-form";
import { ComprobanteViewer, fechaDeSubida } from "../../comprobante-viewer";
import "../../reservas.css";

export default async function EditReservationPage({ params }: { params: Promise<{ code: string }> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const { code } = await params;
  const reservation = await getReservationByCode(code.toUpperCase());
  if (!reservation) notFound();

  const airport = reservation.bookingMode === "AIRPORT" ? reservation.airportDetails : null;
  const pickup = reservation.status === "CANCELLED" ? null : airport ?? reservation.chapelcoDetails;
  const point: PickupPoint | null = pickup?.pickupLatitude != null && pickup.pickupLongitude != null
    ? [pickup.pickupLatitude, pickup.pickupLongitude] : null;
  const coverage = airport && pickup ? await getAirportCoverage() : initialAirportCoverage;
  // Recargo vigente: si el operador mueve el punto a la zona con recargo, se cobra este monto.
  const zoneExtraConfigCents = airport ? (await getAirportExtras()).zoneExtraCents : 0;
  const service = await serviceMoveFor(reservation);

  // Mismas reglas que el listado: el comprobante se sube mientras el pago está pendiente o
  // rechazado, y la documentación de la tarifa sin cargo sólo la toca administración.
  const esDocumentacion = reservation.payment?.provider === DISABILITY_DOCUMENT_PROVIDER;
  const puedeVerComprobante = !esDocumentacion || isAdminRole(user.role);
  const tieneComprobante = Boolean(reservation.payment?.receiptBlobPathname) && puedeVerComprobante;
  // Regla única (receipt-policy), la misma del guard del servidor: si el pago ya se registró sin
  // comprobante, la pantalla ofrece adjuntarlo; si ya tiene uno validado, no ofrece nada.
  const politicaComprobante = politicaDeComprobante(reservation.status, reservation.payment
    ? {
        provider: reservation.payment.provider,
        status: reservation.payment.status,
        hasReceipt: Boolean(reservation.payment.receiptBlobPathname)
      }
    : null);
  const puedeSubirComprobante = politicaComprobante !== "bloqueado" && puedeVerComprobante;
  const reemplazaComprobante = politicaComprobante === "reemplazar";
  const correctPayment = canCorrectManualPayment(reservation.status, reservation.payment);
  const editPrice = canEditReservationTotal(reservation.status, reservation.payment);
  // Cargar el pago también desde acá (no sólo desde el detalle): mismas reglas que «Registrar pago».
  const registerPayment = canRegisterManualPayment(reservation.status, reservation.totalCents, reservation.payment);
  const total = new Intl.NumberFormat("es-AR", { style: "currency", currency: reservation.currency }).format(reservation.total);
  const detailPath = `/admin/reservas/${reservation.code}`;
  // Borrar vive acá y no en el listado: misma regla de siempre, sólo administración y nunca una
  // reserva con el pago aprobado (las sin cargo sí, porque no tienen plata detrás).
  const disability = reservation.payment?.provider === DISABILITY_DOCUMENT_PROVIDER || reservation.status === "DOCUMENTATION_PENDING";
  const canDelete = isAdminRole(user.role) && (reservation.payment?.status !== "APPROVED" || disability);
  // Base del total (#267): con esto el formulario muestra la diferencia antes de guardar y la
  // cantidad de pasajeros/equipaje se recalcula sin volver a consultar la base.
  // Ruta con paradas: la tarifa por persona es la de la parada donde baja (la misma cuenta del alta).
  const priceBasis = {
    priceCents: tarifaPorPersona(reservation.route, reservation.dropoffStop, reservation.boardingStop),
    passengerCount: reservation.passengerCount,
    halfFareCount: reservation.halfFareCount ?? 0,
    freeFareCount: reservation.freeFareCount ?? 0,
    paihuenUnitCents: airport?.paihuenUnitCents ?? 0,
    zoneExtraCents: airport?.zoneExtraCents ?? 0,
    sportsLuggageCount: airport?.sportsLuggageCount ?? 0,
    sportsLuggageUnitCents: airport?.sportsLuggageUnitCents ?? 0
  };

  return (
    <AdminShell title="Editar reserva" eyebrow={reservation.code} role={user.role}
      action={<Link className="ghost-button" href={detailPath}>Volver al detalle</Link>}>
      {registerPayment ? (
        <section className="plain-card admin-section" aria-labelledby="cargar-pago">
          <h2 id="cargar-pago">Cargar pago</h2>
          <RegistrarPagoForm code={reservation.code} total={total} />
        </section>
      ) : null}
      {tieneComprobante || puedeSubirComprobante ? (
        <section className="plain-card admin-section" aria-labelledby="comprobante">
          <h2 id="comprobante">{esDocumentacion ? "Documentación" : "Comprobante"}</h2>
          {tieneComprobante ? (
            <ComprobanteViewer
              href={`${detailPath}/comprobante`}
              fileName={reservation.payment?.receiptFileName}
              subido={fechaDeSubida(reservation.payment?.receiptUploadedAt)}
            />
          ) : (
            <p className="muted">Todavía no hay un comprobante cargado.</p>
          )}
          {puedeSubirComprobante ? (
            <ReceiptUploadForm code={reservation.code} replace={reemplazaComprobante} />
          ) : (
            <p className="muted">El pago ya no admite un comprobante nuevo.</p>
          )}
        </section>
      ) : null}
      <section className="plain-card admin-section">
        <ReservationEditForm action={updateReservationAction} code={reservation.code} passenger={reservation.passenger}
          referredBy={reservation.referredBy ?? ""}
          service={service ?? undefined}
          counts={reservation.status === "CANCELLED" ? undefined : {
            price: priceBasis,
            totalCents: reservation.totalCents,
            currency: reservation.currency,
            airport: Boolean(airport),
            // La tarifa sin cargo por discapacidad es de un solo pasajero adulto: ahí no se cargan menores.
            disability,
            route: reservation.route,
            boardingStop: reservation.boardingStop ?? "",
            dropoffStop: reservation.dropoffStop ?? "",
            zoneExtraConfigCents,
            paymentApproved: reservation.payment?.status === "APPROVED" && reservation.payment.provider !== DISABILITY_DOCUMENT_PROVIDER,
            paymentReceiptPending: reservation.payment?.status === "PENDING" && Boolean(reservation.payment.receiptBlobPathname)
              && reservation.payment.provider !== DISABILITY_DOCUMENT_PROVIDER
          }}
          transfer={pickup ? {
            address: pickup.pickupAddress ?? "", point, notes: pickup.pickupNotes ?? "", name: pickup.pickupName ?? "",
            airport: Boolean(airport), direction: airport?.direction, coverage
          } : undefined}
          financial={editPrice || correctPayment ? {
            operation: correctPayment ? "correctPayment" : "price",
            currency: reservation.currency,
            total: (reservation.totalCents / 100).toFixed(2),
            method: reservation.payment?.method ?? "",
            reference: reservation.payment?.externalRef ?? ""
          } : undefined} />
      </section>
      {canDelete ? (
        <section className="plain-card admin-section" aria-labelledby="borrar-reserva">
          <h2 id="borrar-reserva">Borrar reserva</h2>
          <p className="muted">Borra la reserva y su comprobante. No se puede deshacer; para dejar registro, cancelala.</p>
          <form action={manageReservationAction}>
            <input type="hidden" name="code" value={reservation.code} />
            <ConfirmReservationButton operation="delete" />
          </form>
        </section>
      ) : null}
    </AdminShell>
  );
}
