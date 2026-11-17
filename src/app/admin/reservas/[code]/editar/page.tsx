import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { initialAirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { canCorrectManualPayment, canEditReservationTotal } from "@/lib/booking/admin-price";
import { getReservationByCode } from "@/lib/booking/repository";
import { DISABILITY_DOCUMENT_PROVIDER } from "@/lib/booking/disability-fare";
import { isAdminRole } from "@/lib/auth/roles";
import { manageReservationAction, updateReservationAction } from "../../actions";
import { ConfirmReservationButton } from "../confirm-reservation-button";
import { ReservationEditForm } from "../reservation-edit-form";
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
  const correctPayment = canCorrectManualPayment(reservation.status, reservation.payment);
  const editPrice = canEditReservationTotal(reservation.status, reservation.payment);
  const detailPath = `/admin/reservas/${reservation.code}`;
  // Borrar vive acá y no en el listado: misma regla de siempre, sólo administración y nunca una
  // reserva con el pago aprobado (las sin cargo sí, porque no tienen plata detrás).
  const disability = reservation.payment?.provider === DISABILITY_DOCUMENT_PROVIDER || reservation.status === "DOCUMENTATION_PENDING";
  const canDelete = isAdminRole(user.role) && (reservation.payment?.status !== "APPROVED" || disability);

  return (
    <AdminShell title="Editar reserva" eyebrow={reservation.code} role={user.role}
      action={<Link className="ghost-button" href={detailPath}>Volver al detalle</Link>}>
      <section className="plain-card admin-section">
        <ReservationEditForm action={updateReservationAction} code={reservation.code} passenger={reservation.passenger}
          referredBy={reservation.referredBy ?? ""}
          transfer={pickup ? {
            address: pickup.pickupAddress ?? "", point, notes: pickup.pickupNotes ?? "",
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
