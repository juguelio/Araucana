import { AirportCheckoutForm } from "@/app/reservar/[slug]/airport-checkout-form";
import { RoundTripCheckoutForm } from "@/app/reservar/[slug]/ida-y-vuelta/round-trip-checkout-form";
import { loadAirportCheckoutFlights } from "@/lib/airport/checkout-flights";
import { getAirportFares } from "@/lib/airport/fares";
import { getAirportExtras } from "@/lib/airport/extras-settings";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { getAirportOfficePickup, officePickupReady } from "@/lib/airport/office-pickup";
import { argentinaDateKey } from "@/lib/booking/admin-filters";

/** Dónde vive el alta de aeropuerto: la pantalla única de «Reservar», con el aeropuerto elegido. */
export const ALTA_AEROPUERTO = "/admin/reservas/nueva?servicio=aeropuerto";

export type ParametrosAltaAeropuerto = { date?: string; tramos?: string; sentido?: string; vuelo?: string };

/**
 * El alta de aeropuerto del panel (un tramo o ida y vuelta), sin la página alrededor: la usa la
 * pantalla única de «Reservar» (pedido de Jugue, 19-nov: «que todo se pueda hacer desde la misma
 * pantalla»). Es lo que antes era `/admin/aeropuerto/reservar`, que ahora redirige acá.
 */
export async function AeropuertoAlta({ date, tramos, sentido, vuelo }: ParametrosAltaAeropuerto) {
  // El vuelo ya elegido al pasar de un tramo a ida y vuelta (o al revés).
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

  if (!route || !checkout) return <p className="muted">No hay rutas de aeropuerto activas para reservar.</p>;

  return idaYVuelta ? (
    <RoundTripCheckoutForm
      fromAdmin
      singleHrefs={{
        ARRIVAL: `${ALTA_AEROPUERTO}&date=${initialDate}&sentido=ARRIVAL`,
        DEPARTURE: `${ALTA_AEROPUERTO}&date=${initialDate}&sentido=DEPARTURE`
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
  ) : (
    <AirportCheckoutForm
      fromAdmin
      route={route}
      fares={fares}
      initialDirection={sentidoPedido ?? (fares.ARRIVAL ? "ARRIVAL" : "DEPARTURE")}
      startAtFlights={Boolean(sentidoPedido)}
      initialFlightId={vueloElegido}
      // «Agregar vuelta» lleva al alta de ida y vuelta, con el día, el sentido y el vuelo.
      roundTripHref={`${ALTA_AEROPUERTO}&date=${initialDate}&tramos=ida-y-vuelta`}
      initialDate={initialDate}
      initialFlights={checkout.flights}
      coverage={checkout.coverage}
      extras={checkout.extras}
      officePickup={officePickupReady(checkout.officePickup) ? checkout.officePickup : null}
    />
  );
}
