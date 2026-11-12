import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { getPublicRouteBySlug } from "@/lib/booking/repository";
import { loadAirportCheckoutFlights } from "@/lib/airport/checkout-flights";
import { getAirportFares } from "@/lib/airport/fares";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { RoundTripCheckoutForm } from "./round-trip-checkout-form";

export const revalidate = 300;

function todayInputValue() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Salta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

type RutaPageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ date?: string }>;
};

/**
 * Ida y vuelta del traslado al aeropuerto (#36): los dos vuelos y los dos pickups en una sola
 * operación, con los datos del pasajero cargados una vez. Cada tramo se crea como su propia
 * reserva (mismo `roundTripId`), así que se paga y se cancela por separado.
 */
export default async function AirportRoundTripPage({ params, searchParams }: RutaPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const route = await getPublicRouteBySlug(slug);

  if (!route || route.bookingMode !== "AIRPORT") {
    notFound();
  }

  const fechaDelLink = typeof query?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : null;
  const fecha = fechaDelLink ?? todayInputValue();
  const [vuelos, tarifas, coverage] = await Promise.all([loadAirportCheckoutFlights(fecha), getAirportFares(), getAirportCoverage()]);
  const ambosSentidos = Boolean(tarifas.ARRIVAL && tarifas.DEPARTURE);

  return (
    <>
      <main className="page-shell section">
        <div className="section-head checkout-head">
          <div>
            <p className="eyebrow">Reserva web · ida y vuelta</p>
            <h1 className="section-title">Aeropuerto Chapelco - San Martín de los Andes</h1>
          </div>
          <div className="route-summary plain-card">
            <span>Los dos tramos</span>
            <strong>
              {ambosSentidos
                ? `${formatPrice(tarifas.ARRIVAL!.priceCents, tarifas.ARRIVAL!.currency)} la llegada · ${formatPrice(tarifas.DEPARTURE!.priceCents, tarifas.DEPARTURE!.currency)} la vuelta`
                : "Sin tarifa activa para uno de los sentidos"}
            </strong>
          </div>
        </div>

        <section className="checkout-intro">
          <div>
            <p className="eyebrow">{route.category}</p>
            <h2 className="route-title">Reservá la llegada y la vuelta juntas</h2>
            <p className="lead">
              Elegís los dos vuelos y los dos lugares de búsqueda, y cargás los datos del pasajero una
              sola vez. Cada tramo queda con su código y su pago.
            </p>
          </div>
          <div className="stats-grid checkout-stats">
            <div className="stat-card">
              <strong>2</strong>
              <span>Tramos en una sola reserva</span>
            </div>
            <div className="stat-card">
              <strong>1</strong>
              <span>Planilla de datos del pasajero</span>
            </div>
          </div>
        </section>

        {ambosSentidos ? (
          <RoundTripCheckoutForm
            route={{ slug: route.slug, from: route.from, to: route.to, priceCents: route.priceCents, currency: route.currency }}
            fares={tarifas}
            initialDate={fecha}
            initialFlights={vuelos}
            coverage={coverage}
          />
        ) : (
          <section className="form-panel checkout-panel">
            <h2 className="route-title">Ida y vuelta no está disponible</h2>
            <p className="muted">
              Falta la tarifa de uno de los dos sentidos. Podés reservar un tramo solo desde{" "}
              <Link className="table-link" href={`/reservar/${route.slug}?date=${fecha}`}>
                la reserva de un tramo
              </Link>
              .
            </p>
          </section>
        )}

        <p className="muted">
          ¿Necesitás un solo tramo o un vuelo privado?{" "}
          <Link className="table-link" href={`/reservar/${route.slug}?date=${fecha}`}>
            Reservá un tramo
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
