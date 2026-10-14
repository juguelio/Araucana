import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { listPublicRoutes, listSchedulesForRoute } from "@/lib/booking/repository";

export const revalidate = 300;

function todayDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Salta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

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

function scheduleDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Salta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatScheduleDate(date: Date) {
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "America/Argentina/Salta"
  }).format(date).replace(/\.$/, "");
}

function formatScheduleTime(date: Date) {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Salta"
  }).format(date);
}

async function getRoutesWithScheduleCount(date?: string) {
  const routes = await listPublicRoutes();
  const schedules = await Promise.all(routes.map((route) => listSchedulesForRoute(route.id)));
  const today = todayDateKey();

  return routes.map((route, index) => ({
    ...route,
    schedules: (schedules[index] ?? []).filter((schedule) => scheduleDateKey(schedule.departureAt) >= today && (!date || scheduleDateKey(schedule.departureAt) === date)),
    scheduleCount: (schedules[index] ?? []).filter((schedule) => scheduleDateKey(schedule.departureAt) >= today && (!date || scheduleDateKey(schedule.departureAt) === date)).length
  }));
}

type RoutesPageProps = {
  searchParams?: Promise<{ from?: string; to?: string; date?: string }>;
};

export default async function RoutesPage({ searchParams }: RoutesPageProps) {
  const params = await searchParams;
  const from = params?.from?.trim() ?? "";
  const to = params?.to?.trim() ?? "";
  const date = params?.date?.trim() ?? "";
  const allRoutes = await getRoutesWithScheduleCount(date || undefined);
  const routes = allRoutes.filter((route) => (!from || route.from === from) && (!to || route.to === to));
  const origins = Array.from(new Set(allRoutes.map((route) => route.from)));
  const destinations = Array.from(new Set(allRoutes.map((route) => route.to)));

  return (
    <>
      <main className="page-shell section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Rutas y horarios</p>
            <h1 className="section-title">Elegí tu próximo tramo.</h1>
          </div>
          <Link className="button" href="#salidas">
            Buscar salidas
          </Link>
        </div>

        <form className="form-panel route-search-form" action="/rutas" method="get">
          <label>
            Origen
            <select name="from" defaultValue={from}>
              <option value="">Todos los orígenes</option>
              {origins.map((origin) => (
                <option value={origin} key={origin}>
                  {origin}
                </option>
              ))}
            </select>
          </label>
          <label>
            Destino
            <select name="to" defaultValue={to}>
              <option value="">Todos los destinos</option>
              {destinations.map((destination) => (
                <option value={destination} key={destination}>
                  {destination}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fecha de viaje
            <input type="date" name="date" defaultValue={date || todayDateKey()} />
          </label>
          <button className="button" type="submit">
            Buscar salidas
          </button>
        </form>

        <section className="section" id="salidas">
          <div className="route-grid">
            {routes.length ? routes.map((route) => (
              <article className={`route-card ${route.featured ? "featured" : ""}`} key={route.id}>
                <div className="route-media" />
                <div className="route-body">
                  <span className="route-kicker">{route.category}</span>
                  <h2 className="route-title">
                    {route.from} → {route.to}
                  </h2>
                  <p className="muted">{route.via}</p>
                  <p>{route.description}</p>
                  <div className="route-meta">
                    <span>{formatDuration(route.durationMin)} · {route.scheduleCount} salidas disponibles</span>
                    <span className="price">{formatPrice(route.priceCents, route.currency)}</span>
                  </div>
                  <form className="route-quick-book" action={`/reservar/${route.slug}`}>
                    {route.schedules.length ? <fieldset className="schedule-picker">
                      <legend>Elegí tu salida</legend>
                      <div className="schedule-rail" aria-label="Salidas disponibles">
                        {route.schedules.map((schedule, index) => (
                          <label className="schedule-option" key={schedule.id}>
                            <input type="radio" name="scheduleId" value={schedule.id} defaultChecked={index === 0} />
                            <span className="schedule-card">
                              <span className="schedule-date">{formatScheduleDate(schedule.departureAt)}</span>
                              <strong className="schedule-time">{formatScheduleTime(schedule.departureAt)}</strong>
                              <span className="schedule-seats">{schedule.availableSeats} asientos</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset> : null}
                     <button className="button" type="submit">Consultar disponibilidad ↗</button>
                  </form>
                  <Link className="route-detail-link" href={`/rutas/${route.slug}`} prefetch={true}>
                    Ver detalles de la ruta
                  </Link>
                </div>
              </article>
            )) : <div className="empty-search-state"><strong>No encontramos rutas con esos datos.</strong><p>Probá con otro origen, destino o fecha.</p><Link className="button" href="/rutas">Limpiar búsqueda</Link></div>}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
