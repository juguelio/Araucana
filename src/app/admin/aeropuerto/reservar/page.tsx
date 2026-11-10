import Link from "next/link";
import { AirportCheckoutForm } from "@/app/reservar/[slug]/airport-checkout-form";
import { AdminShell } from "@/components/admin-shell";
import { loadAirportCheckoutFlights } from "@/lib/airport/checkout-flights";
import { getAirportFares } from "@/lib/airport/fares";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { argentinaDateKey } from "@/lib/booking/admin-filters";

export default async function NewAirportReservationPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const { date } = await searchParams;
  const today = argentinaDateKey(new Date());
  const initialDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today ? date : today;
  const fares = await getAirportFares();
  const route = fares.ARRIVAL ?? fares.DEPARTURE;
  const flights = route ? await loadAirportCheckoutFlights(initialDate) : [];

  return (
    <AdminShell
      title="Nueva reserva de aeropuerto"
      eyebrow="Carga manual"
      role={user.role}
      action={<Link className="ghost-button" href="/admin/aeropuerto">Volver a aeropuerto</Link>}
    >
      {route ? (
        <AirportCheckoutForm
          fromAdmin
          route={route}
          fares={fares}
          initialDirection={fares.ARRIVAL ? "ARRIVAL" : "DEPARTURE"}
          initialDate={initialDate}
          initialFlights={flights}
        />
      ) : <p className="muted">No hay rutas de aeropuerto activas para reservar.</p>}
    </AdminShell>
  );
}
