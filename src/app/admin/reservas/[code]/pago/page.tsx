import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { canRegisterManualPayment } from "@/lib/booking/admin-price";
import { getReservationByCode } from "@/lib/booking/repository";
import { RegistrarPagoForm } from "../registrar-pago-form";

export default async function RegisterReservationPaymentPage({ params }: { params: Promise<{ code: string }> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const { code } = await params;
  const reservation = await getReservationByCode(code.toUpperCase());
  if (!reservation) notFound();

  const detailPath = `/admin/reservas/${reservation.code}`;
  if (!canRegisterManualPayment(reservation.status, reservation.totalCents, reservation.payment)) redirect(detailPath);
  const total = new Intl.NumberFormat("es-AR", { style: "currency", currency: reservation.currency }).format(reservation.total);

  return (
    <AdminShell title="Registrar pago" eyebrow={reservation.code} role={user.role}
      action={<Link className="ghost-button" href={detailPath}>Volver al detalle</Link>}>
      <section className="plain-card admin-section">
        <h2>{reservation.passenger.firstName} {reservation.passenger.lastName}</h2>
        <RegistrarPagoForm code={reservation.code} total={total} method={reservation.payment?.method} />
      </section>
    </AdminShell>
  );
}
