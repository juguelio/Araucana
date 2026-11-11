import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { canRegisterManualPayment } from "@/lib/booking/admin-price";
import { getReservationByCode } from "@/lib/booking/repository";
import { manageReservationAction } from "../../actions";

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
        <p>Registrá el pago cuando hayas recibido el total de {total}.</p>
        <form className="admin-form-grid" action={manageReservationAction}>
          <input type="hidden" name="code" value={reservation.code} />
          <input type="hidden" name="operation" value="payment" />
          <label>Forma de pago<input name="method" maxLength={60} placeholder="Efectivo, transferencia, tarjeta…" /></label>
          <label>Referencia (opcional)<input name="reference" maxLength={120} /></label>
          <button className="button" type="submit">Registrar pago</button>
        </form>
      </section>
    </AdminShell>
  );
}
