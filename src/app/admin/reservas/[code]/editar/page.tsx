import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { initialAirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { canCorrectManualPayment, canEditReservationTotal } from "@/lib/booking/admin-price";
import { getReservationByCode } from "@/lib/booking/repository";
import { updateReservationAction } from "../../actions";
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

  return (
    <AdminShell title="Editar reserva" eyebrow={reservation.code} role={user.role}
      action={<Link className="ghost-button" href={detailPath}>Volver al detalle</Link>}>
      <section className="plain-card admin-section">
        <ReservationEditForm action={updateReservationAction} code={reservation.code} passenger={reservation.passenger}
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
    </AdminShell>
  );
}
