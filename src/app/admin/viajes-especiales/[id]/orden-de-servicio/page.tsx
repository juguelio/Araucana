import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { CopiarLink } from "@/components/copiar-link";
import { ImprimirTodas } from "@/components/imprimir-todas";
import { SpecialTripOrderSheet } from "@/components/special-trip-order-sheet";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { siteOrigin } from "@/lib/site-origin";
import { getSpecialTripOrder } from "@/lib/special-trips/service-order";
import { specialTripOrderPath } from "@/lib/special-trips/service-order-link";

export const metadata = { title: "Orden de servicio de viaje especial" };

export default async function SpecialTripOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const { id } = await params;
  const trip = await getSpecialTripOrder(id);
  if (!trip) notFound();
  const path = trip.status === "CANCELLED" ? null : specialTripOrderPath(trip);
  return (
    <AdminShell title="Orden de servicio" eyebrow="Viajes especiales" role={user.role}
      action={<div className="form-actions no-print">
        <Link className="ghost-button" href={`/admin/viajes-especiales/${id}`}>Volver al viaje</Link>
        <ImprimirTodas cantidad={1} />
      </div>}>
      {path && <CopiarLink url={`${await siteOrigin()}${path}`} ayuda="El chofer puede abrir la hoja sin usuario hasta el día siguiente a la finalización del viaje." />}
      <SpecialTripOrderSheet trip={trip} />
    </AdminShell>
  );
}
