import { notFound } from "next/navigation";
import { ImprimirTodas } from "@/components/imprimir-todas";
import { SpecialTripOrderSheet } from "@/components/special-trip-order-sheet";
import { claveDe, ultimoDia } from "@/lib/special-trips/rango";
import { getSpecialTripOrder } from "@/lib/special-trips/service-order";
import { readSpecialTripOrderLink } from "@/lib/special-trips/service-order-link";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Orden de servicio de viaje especial",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const
};

export default async function DriverSpecialTripOrder({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = readSpecialTripOrderLink(token);
  if (!link) notFound();
  const trip = await getSpecialTripOrder(link.tripId);
  if (!trip || claveDe(ultimoDia(trip)) !== link.lastDay) notFound();
  if (trip.status === "CANCELLED") return (
    <main className="page-shell section"><h1>Viaje cancelado</h1><p>Se canceló el servicio de {trip.client}.</p></main>
  );
  return (
    <main className="page-shell section orden-publica">
      <div className="orden-publica-acciones no-print"><ImprimirTodas cantidad={1} /></div>
      <SpecialTripOrderSheet trip={trip} />
    </main>
  );
}
