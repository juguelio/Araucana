import Link from "next/link";
import { AirportCheckoutForm } from "@/app/reservar/[slug]/airport-checkout-form";
import { RoundTripCheckoutForm } from "@/app/reservar/[slug]/ida-y-vuelta/round-trip-checkout-form";
import { AdminShell } from "@/components/admin-shell";
import { loadAirportCheckoutFlights } from "@/lib/airport/checkout-flights";
import { getAirportFares } from "@/lib/airport/fares";
import { getAirportExtras } from "@/lib/airport/extras-settings";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { getAirportOfficePickup, officePickupReady } from "@/lib/airport/office-pickup";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { argentinaDateKey } from "@/lib/booking/admin-filters";

export default async function NewAirportReservationPage({ searchParams }: { searchParams: Promise<{ date?: string; tramos?: string; sentido?: string; vuelo?: string }> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const { date, tramos, sentido, vuelo } = await searchParams;
  // El vuelo ya elegido al pasar de un tramo a ida y vuelta (o al revés) con «¿Ida y vuelta?».
  const vueloElegido = typeof vuelo === "string" && /^[\w-]{1,64}$/.test(vuelo) ? vuelo : undefined;
  const sentidoPedido = sentido === "ARRIVAL" || sentido === "DEPARTURE" ? sentido : null;
  const idaYVuelta = tramos === "ida-y-vuelta";
  const today = argentinaDateKey(new Date());
  const initialDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today ? date : today;
  const fares = await getAirportFares();
  const route = fares.ARRIVAL ?? fares.DEPARTURE;
  const checkout = route ? await Promise.all([
    loadAirportCheckoutFlights(initialDate), getAirportCoverage(), getAirportExtras(), getAirportOfficePickup()
  ]).then(([flights, coverage, extras, officePickup]) => ({ flights, coverage, extras, officePickup })) : null;

  return (
    <AdminShell
      title="Nueva reserva de aeropuerto"
      eyebrow="Carga manual"
      role={user.role}
      action={<Link className="ghost-button" href="/admin/aeropuerto">Volver a aeropuerto</Link>}
    >
      {route && checkout && idaYVuelta ? (
        <RoundTripCheckoutForm
          fromAdmin
          singleHrefs={{
            ARRIVAL: `/admin/aeropuerto/reservar?date=${initialDate}&sentido=ARRIVAL`,
            DEPARTURE: `/admin/aeropuerto/reservar?date=${initialDate}&sentido=DEPARTURE`
          }}
          route={route}
          fares={fares}
          initialDate={initialDate}
          initialFlights={checkout.flights}
          initialOrder={sentidoPedido ?? "ARRIVAL"}
          initialFirstFlightId={vueloElegido}
          coverage={checkout.coverage}
          extras={checkout.extras}
          officePickup={officePickupReady(checkout.officePickup) ? checkout.officePickup : null}
        />
      ) : route && checkout ? (
        <AirportCheckoutForm
          fromAdmin
          route={route}
          fares={fares}
          initialDirection={sentidoPedido ?? (fares.ARRIVAL ? "ARRIVAL" : "DEPARTURE")}
          startAtFlights={Boolean(sentidoPedido)}
          initialFlightId={vueloElegido}
          // «¿Ida y vuelta?» lleva al alta de ida y vuelta del panel, con el día, el sentido y el vuelo.
          roundTripHref={`/admin/aeropuerto/reservar?date=${initialDate}&tramos=ida-y-vuelta`}
          initialDate={initialDate}
          initialFlights={checkout.flights}
          coverage={checkout.coverage}
          extras={checkout.extras}
          officePickup={officePickupReady(checkout.officePickup) ? checkout.officePickup : null}
        />
      ) : <p className="muted">No hay rutas de aeropuerto activas para reservar.</p>}
    </AdminShell>
  );
}
