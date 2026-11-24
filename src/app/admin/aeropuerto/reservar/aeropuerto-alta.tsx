import { AirportTransferChoice } from "./private-checkout";
import { opcionesDeNave } from "../combi-modal";
import { AirportCheckoutForm } from "@/app/reservar/[slug]/airport-checkout-form";
import { RoundTripCheckoutForm } from "@/app/reservar/[slug]/ida-y-vuelta/round-trip-checkout-form";
import { loadAirportCheckoutFlights } from "@/lib/airport/checkout-flights";
import { getAirportFares } from "@/lib/airport/fares";
import { getAirportExtras } from "@/lib/airport/extras-settings";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { getAirportOfficePickup, officePickupReady } from "@/lib/airport/office-pickup";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import type { LugarDeOtroServicio } from "@/app/reservar/[slug]/ida-y-vuelta/trip-search-bar";

/** Dónde vive el alta de aeropuerto: la pantalla única de «Reservar», con el aeropuerto elegido. */
export const ALTA_AEROPUERTO = "/admin/reservas/nueva?servicio=aeropuerto";

export type ParametrosAltaAeropuerto = { date?: string; tramos?: string; sentido?: string; vuelo?: string; abrir?: string };

/**
 * El alta de aeropuerto del panel (un tramo o ida y vuelta), sin la página alrededor: la usa la
 * pantalla única de «Reservar» (pedido de Jugue, 19-nov: «que todo se pueda hacer desde la misma
 * pantalla»). Es lo que antes era `/admin/aeropuerto/reservar`, que ahora redirige acá.
 */
export async function AeropuertoAlta({ date, tramos, sentido, vuelo, abrir, lugaresExtra, sentidoPorDefecto }: ParametrosAltaAeropuerto & {
  /** Sin sentido en el link: «Reservar» abre en San Martín → Aeropuerto (salida), sin bajar sola. */
  sentidoPorDefecto?: "ARRIVAL" | "DEPARTURE";
  /** Los lugares de las rutas por salida en Desde/Hacia (19-nov: todo desde la misma pantalla). */
  lugaresExtra?: { desde: LugarDeOtroServicio[]; hacia: LugarDeOtroServicio[] };
}) {
  // El vuelo ya elegido al pasar de un tramo a ida y vuelta (o al revés).
  const vueloElegido = typeof vuelo === "string" && /^[\w-]{1,64}$/.test(vuelo) ? vuelo : undefined;
  const sentidoPedido = sentido === "ARRIVAL" || sentido === "DEPARTURE" ? sentido : null;
  const idaYVuelta = tramos === "ida-y-vuelta";
  const today = argentinaDateKey(new Date());
  const initialDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today ? date : today;
  const fares = await getAirportFares();
  const route = fares.ARRIVAL ?? fares.DEPARTURE;
  if (!route) return <p className="muted">No hay rutas de aeropuerto activas para reservar.</p>;

  const [flights, coverage, extras, officePickup, vehicles] = await Promise.all([
    loadAirportCheckoutFlights(initialDate), getAirportCoverage(), getAirportExtras(), getAirportOfficePickup(), opcionesDeNave()
  ]);
  const preferredDirection = sentidoPedido ?? sentidoPorDefecto;
  const initialDirection = preferredDirection && fares[preferredDirection] ? preferredDirection : fares.ARRIVAL ? "ARRIVAL" : "DEPARTURE";

  return (
    <AirportTransferChoice slug={route.slug} fares={fares} initialDate={initialDate} initialFlights={flights}
      initialFlightId={vueloElegido} roundTrip={idaYVuelta} vehicles={vehicles} initialDirection={initialDirection}>
      {idaYVuelta ? (
        <RoundTripCheckoutForm
          fromAdmin
          // «Agregar vuelta» ya no pide un segundo toque: la vuelta entra con sus días abiertos.
          abrirLaVuelta={abrir === "vuelta"}
          lugaresExtra={lugaresExtra}
          singleHrefs={{
            ARRIVAL: `${ALTA_AEROPUERTO}&date=${initialDate}&sentido=ARRIVAL`,
            DEPARTURE: `${ALTA_AEROPUERTO}&date=${initialDate}&sentido=DEPARTURE`
          }}
          route={route}
          fares={fares}
          initialDate={initialDate}
          initialFlights={flights}
          initialOrder={sentidoPedido ?? sentidoPorDefecto ?? "ARRIVAL"}
          initialFirstFlightId={vueloElegido}
          coverage={coverage}
          extras={extras}
          officePickup={officePickupReady(officePickup) ? officePickup : null}
        />
      ) : (
        <AirportCheckoutForm
          fromAdmin
          lugaresExtra={lugaresExtra}
          route={route}
          fares={fares}
          initialDirection={initialDirection}
          startAtFlights={Boolean(sentidoPedido)}
          initialFlightId={vueloElegido}
          // «Agregar vuelta» lleva al alta de ida y vuelta, con el día, el sentido y el vuelo.
          roundTripHref={`${ALTA_AEROPUERTO}&date=${initialDate}&tramos=ida-y-vuelta`}
          initialDate={initialDate}
          initialFlights={flights}
          coverage={coverage}
          extras={extras}
          officePickup={officePickupReady(officePickup) ? officePickup : null}
        />
      )}
    </AirportTransferChoice>
  );
}
