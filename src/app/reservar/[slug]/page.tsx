import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { getPublicRouteBySlug, listPublicRoutes, listSchedulesForRoute } from "@/lib/booking/repository";
import { loadAirportCheckoutFlights } from "@/lib/airport/checkout-flights";
import { getAirportFares } from "@/lib/airport/fares";
import { getAirportExtras } from "@/lib/airport/extras-settings";
import { getAirportOfficePickup, officePickupReady } from "@/lib/airport/office-pickup";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { getChapelcoAvailability } from "@/lib/chapelco/repository";
import { mismoLugar } from "@/lib/booking/place-names";
import { corridorStops } from "@/lib/booking/segment-fares";
import { etiquetasDeSalida } from "@/lib/booking/schedule-days";
import { CheckoutForm } from "./checkout-form";
import { AirportCheckoutForm } from "./airport-checkout-form";
import { ChapelcoCheckoutForm } from "./chapelco-checkout-form";

export const revalidate = 300;

type ReservationPageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams?: Promise<{
    scheduleId?: string;
    from?: string;
    to?: string;
    tramos?: string;
    /** Día elegido (YYYY-MM-DD) para el flujo del aeropuerto: permite linkear "vuelos del 20/10". */
    date?: string;
    /** Llegada o salida elegida en la tarjeta de otra pantalla (ida y vuelta): entra directo al vuelo. */
    sentido?: string;
    /** Vuelo ya elegido al destildar «¿Ida y vuelta?»: se conserva. */
    vuelo?: string;
  }>;
};

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (!hours) {
    return `${remainder} min`;
  }

  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

function formatPrice(cents: number, currency: string) {
  if (cents <= 0) {
    return "Consultar";
  }

  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(cents / 100);
}

function isBookableSchedule(status: string) {
  return status === "OPEN" || status === "DOCUMENTATION";
}

function todayInputValue() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Salta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function scheduleDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Salta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function initialChapelcoServiceDate(route: { serviceStartDate?: string | null }) {
  const today = todayInputValue();

  if (route.serviceStartDate && today < route.serviceStartDate) {
    return route.serviceStartDate;
  }

  return today;
}

export default async function ReservationPage({ params, searchParams }: ReservationPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const route = await getPublicRouteBySlug(slug);

  if (!route) {
    notFound();
  }

  if (route.bookingMode === "AIRPORT") {
    // El día puede venir en el link (?date=YYYY-MM-DD); si no, se arranca en hoy.
    const fechaDelLink = typeof query?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : null;
    const fecha = fechaDelLink ?? todayInputValue();
    const [vuelos, tarifas, coverage, extras, officePickup] = await Promise.all([
      loadAirportCheckoutFlights(fecha), getAirportFares(), getAirportCoverage(), getAirportExtras(), getAirportOfficePickup()
    ]);
    const sentidoPedido = query?.sentido === "ARRIVAL" || query?.sentido === "DEPARTURE" ? query.sentido : null;
    const vueloElegido = typeof query?.vuelo === "string" && /^[\w-]{1,64}$/.test(query.vuelo) ? query.vuelo : undefined;
    const iguales = tarifas.ARRIVAL && tarifas.DEPARTURE && tarifas.ARRIVAL.priceCents === tarifas.DEPARTURE.priceCents;

    return (
      <>
        <main className="page-shell section">
          <div className="section-head checkout-head">
            <div>
              <p className="eyebrow">Reserva web</p>
              <h1 className="section-title">
                {route.from} - {route.to}
              </h1>
            </div>
            <div className="route-summary plain-card">
              <span>{route.via}</span>
              {iguales ? (
                <strong>{formatPrice(tarifas.ARRIVAL!.priceCents, tarifas.ARRIVAL!.currency)} por persona</strong>
              ) : (
                <strong>
                  {tarifas.ARRIVAL ? `Llegada ${formatPrice(tarifas.ARRIVAL.priceCents, tarifas.ARRIVAL.currency)}` : "Llegada sin tarifa"}
                  {" · "}
                  {tarifas.DEPARTURE ? `Salida ${formatPrice(tarifas.DEPARTURE.priceCents, tarifas.DEPARTURE.currency)}` : "Salida sin tarifa"}
                  {" por persona"}
                </strong>
              )}
            </div>
          </div>
          <AirportCheckoutForm
            initialDirection={sentidoPedido ?? (route.specialType === "DEPARTURE" ? "DEPARTURE" : "ARRIVAL")}
            startAtFlights={Boolean(sentidoPedido)}
            initialFlightId={vueloElegido}
            fares={tarifas}
            route={{
              slug: route.slug,
              priceCents: route.priceCents,
              currency: route.currency
            }}
            initialDate={fecha}
            initialFlights={vuelos}
            coverage={coverage}
            officePickup={officePickupReady(officePickup) ? officePickup : null}
            extras={{ zoneExtraCents: extras.zoneExtraCents, sportsLuggageCents: extras.sportsLuggageCents }}
          />
        </main>
        <SiteFooter />
      </>
    );
  }

  if (route.bookingMode === "CHAPELCO") {
    const availability = await getChapelcoAvailability(route.id, initialChapelcoServiceDate(route));

    return (
      <>
        <main className="page-shell section">
          <div className="section-head checkout-head">
            <div>
              <p className="eyebrow">Reserva web</p>
              <h1 className="section-title">
                {route.from} - {route.to}
              </h1>
            </div>
            <div className="route-summary plain-card">
              <span>{route.via}</span>
              <strong>{formatPrice(route.priceCents, route.currency)} por persona</strong>
            </div>
          </div>

          <section className="checkout-intro">
            <div>
              <p className="eyebrow">{route.category}</p>
              <h2 className="route-title">Reserva tu traslado</h2>
              <p className="lead">{route.description}</p>
            </div>
            <div className="stats-grid checkout-stats">
              <div className="stat-card">
                <strong>08:30 · 09:00 · 10:30 · 12:00</strong>
                <span>Subidas</span>
              </div>
              <div className="stat-card">
                <strong>17:00</strong>
                <span>Bajadas desde</span>
              </div>
            </div>
          </section>

          <ChapelcoCheckoutForm route={route} initialAvailability={availability} />
        </main>
        <SiteFooter />
      </>
    );
  }

  const [schedules, returnServices] = await Promise.all([
    listSchedulesForRoute(route.id),
    corridorStops(route).length ? listPublicRoutes().then(async (routes) => {
      const reverse = routes.filter((r) => corridorStops(r).length && mismoLugar(r.from, route.to) && mismoLugar(r.to, route.from));
      return Promise.all(reverse.map(async (r) => ({
        route: { from: r.from, to: r.to, bookingMode: r.bookingMode, currency: r.currency, priceCents: r.priceCents, stops: r.stops },
        schedules: (await listSchedulesForRoute(r.id)).filter((s) => s.availableSeats > 0)
          .map(({ id, departureAt, availableSeats, priceCents }) => ({ id, departureAt, availableSeats, priceCents }))
      })));
    }) : []
  ]);
  const today = todayInputValue();
  const bookableSchedules = schedules
    // Sólo días con lugares: una salida llena no se puede reservar y no tiene por qué aparecer.
    .filter((schedule) => isBookableSchedule(schedule.status) && schedule.availableSeats > 0 && scheduleDateKey(schedule.departureAt) >= today)
    // Sin la ruta repetida en cada salida: el formulario la recibe una vez por `route`.
    .map(({ route: _route, ...schedule }) => ({ ...schedule, ...etiquetasDeSalida(schedule.departureAt) }));
  const initialScheduleId = query?.scheduleId;

  return (
    <>
      <main className="page-shell section">
        <div className="section-head checkout-head">
          <div>
            <p className="eyebrow">Reserva web</p>
            <h1 className="section-title">
              {route.from} - {route.to}
            </h1>
          </div>
          <div className="route-summary plain-card">
            <span>{corridorStops(route).length ? "Tarifa del recorrido completo" : route.via}</span>
            <strong>{formatPrice(route.priceCents, route.currency)}</strong>
          </div>
        </div>

        <section className="checkout-intro">
          <div>
            <p className="eyebrow">{route.category}</p>
            <h2 className="route-title">Completa tu reserva</h2>
            <p className="lead">{route.description}</p>
          </div>
          <div className="stats-grid checkout-stats">
            <div className="stat-card">
              <strong>{formatDuration(route.durationMin)}</strong>
              <span>Duracion estimada</span>
            </div>
            <div className="stat-card">
              <strong>{bookableSchedules.length}</strong>
              <span>Salidas reservables</span>
            </div>
          </div>
        </section>

        <CheckoutForm route={route} schedules={bookableSchedules} initialScheduleId={initialScheduleId}
          initialFrom={query?.from} initialTo={query?.to} returnServices={returnServices}
          initialRoundTrip={query?.tramos === "ida-y-vuelta"} />
      </main>
      <SiteFooter />
    </>
  );
}
