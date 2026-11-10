import Link from "next/link";
import { getStopFares } from "@/lib/booking/stop-fares";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { getPublicRouteBySlug, listSchedulesForRoute } from "@/lib/booking/repository";

export const revalidate = 300;

type RouteDetailPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

type RouteStop = {
  name: string;
  km: number;
  minutes: number;
  note: string;
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
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(cents / 100);
}

function normalizeStops(stops: unknown): RouteStop[] {
  if (!Array.isArray(stops)) {
    return [];
  }

  return stops
    .map((stop) => {
      if (!stop || typeof stop !== "object") {
        return null;
      }

      const item = stop as { name?: unknown; km?: unknown; minutes?: unknown; note?: unknown };
      return {
        name: String(item.name ?? ""),
        km: Number(item.km ?? 0),
        minutes: Number(item.minutes ?? 0),
        note: String(item.note ?? "")
      };
    })
    .filter((stop): stop is RouteStop => Boolean(stop?.name));
}

export default async function RouteDetailPage({ params }: RouteDetailPageProps) {
  const { slug } = await params;
  const route = await getPublicRouteBySlug(slug);

  if (!route) {
    notFound();
  }

  const schedules = await listSchedulesForRoute(route.id);
  const stops = normalizeStops(route.stops);
  const fares = new Map((route.bookingMode === "SEATED" ? getStopFares(route) : []).map((fare) => [fare.name, fare.priceCents]));
  const duration = formatDuration(route.durationMin);

  return (
    <>
      <main>
        <section className="hero">
          <div className="hero-inner">
            <div className="hero-copy">
              <p className="eyebrow">{route.category} · {duration}</p>
              <h1 className="display-title">
                {route.from} → <em>{route.to}</em>
              </h1>
              <p className="lead">{route.description}</p>
              <div className="hero-actions">
                <Link className="cream-button" href={`/reservar/${route.slug}`} prefetch={true}>
                  Reservar asiento
                </Link>
                <Link className="ghost-button" href="/rutas" prefetch={true}>
                  Volver a rutas
                </Link>
              </div>
            </div>
            <div className="booking-dock">
              <div className="dock-field">
                <span>Via</span>
                <strong>{route.via}</strong>
              </div>
              <div className="dock-field">
                <span>Duracion</span>
                <strong>{duration}</strong>
              </div>
              <div className="dock-field">
                <span>Salidas</span>
                <strong>{schedules.length} disponibles</strong>
              </div>
              <div className="dock-field">
                <span>Desde</span>
                <strong>{formatPrice(route.priceCents, route.currency)}</strong>
              </div>
              <Link className="button" href={`/reservar/${route.slug}`} prefetch={true}>
                Continuar
              </Link>
            </div>
          </div>
        </section>

        <section className="page-shell section">
          <div className="section-head">
            <div>
              <p className="eyebrow">Itinerario</p>
              <h2 className="section-title">Paradas del recorrido.</h2>
            </div>
            <p className="lead">Este detalle será la base del flujo mobile y web de reservas.</p>
          </div>
          <div className="lake-grid">
            {stops.map((stop, index) => {
              const fare = fares.get(stop.name.trim());
              return (
                <div className="lake-card" key={`${stop.name}-${index}`}>
                  <small>0{index + 1} · km {stop.km}</small>
                  <strong>{stop.name}</strong>
                  <p className="muted">{stop.note} · +{stop.minutes}m</p>
                  {fare !== undefined && <p>{formatPrice(fare, route.currency)} por pasajero</p>}
                </div>
              );
            })}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
