import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { getPublicRouteBySlug, listSchedulesForRoute } from "@/lib/booking/repository";
import { loadAirportCheckoutFlights } from "@/lib/airport/checkout-flights";
import { getAirportFares } from "@/lib/airport/fares";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { getChapelcoAvailability } from "@/lib/chapelco/repository";
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
    /** Día elegido (YYYY-MM-DD) para el flujo del aeropuerto: permite linkear "vuelos del 20/10". */
    date?: string;
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
    const [vuelos, tarifas, coverage] = await Promise.all([
      loadAirportCheckoutFlights(fecha), getAirportFares(), getAirportCoverage()
    ]);
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
            initialDirection={route.specialType === "DEPARTURE" ? "DEPARTURE" : "ARRIVAL"}
            fares={tarifas}
            route={{
              slug: route.slug,
              priceCents: route.priceCents,
              currency: route.currency
            }}
            initialDate={fecha}
            initialFlights={vuelos}
            coverage={coverage}
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

  const schedules = await listSchedulesForRoute(route.id);
  const today = todayInputValue();
  const bookableSchedules = schedules
    .filter((schedule) => isBookableSchedule(schedule.status) && scheduleDateKey(schedule.departureAt) >= today)
    // Sin la ruta repetida en cada salida: el formulario la recibe una vez por `route`.
    .map(({ route: _route, ...schedule }) => schedule);
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
            <span>{route.via}</span>
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

        <CheckoutForm route={route} schedules={bookableSchedules} initialScheduleId={initialScheduleId} />
      </main>
      <SiteFooter />
    </>
  );
}
