import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { getI18n } from "@/i18n/server";
import { localizePath } from "@/i18n/config";
import { listPublicRoutes, listSchedulesForRoute } from "@/lib/booking/repository";
import { claveDia, claveHoy, diasConSalidas, etiquetaDia, fechaDeClave, horaDia, tiraDeDias } from "./dias";

export const revalidate = 300;

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

const scheduleDateKey = claveDia;
const formatScheduleDate = etiquetaDia;
const formatScheduleTime = horaDia;

const RAIL_MAX_SCHEDULES = 30;
const DIAS_EN_TIRA = 8;

async function getRoutesWithSchedules() {
  const routes = await listPublicRoutes();
  const schedules = await Promise.all(routes.map((route) => listSchedulesForRoute(route.id)));
  const today = claveHoy();

  return routes.map((route, index) => ({
    ...route,
    vigentes: (schedules[index] ?? []).filter((schedule) => scheduleDateKey(schedule.departureAt) >= today)
  }));
}

type RoutesPageProps = {
  searchParams?: Promise<{ from?: string; to?: string; date?: string }>;
};

export default async function RoutesPage({ searchParams }: RoutesPageProps) {
  const { locale, dict } = await getI18n();
  const t = dict.routes;
  const params = await searchParams;
  const from = params?.from?.trim() ?? "";
  const to = params?.to?.trim() ?? "";
  const date = params?.date?.trim() ?? "";
  const allRoutes = await getRoutesWithSchedules();
  const origins = Array.from(new Set(allRoutes.map((route) => route.from)));
  const destinations = Array.from(new Set(allRoutes.map((route) => route.to)));

  const candidatas = allRoutes.filter((route) => (!from || route.from === from) && (!to || route.to === to));
  const dias = diasConSalidas(candidatas.flatMap((route) => route.vigentes.map((schedule) => schedule.departureAt)));
  // Sólo se filtra por un día que tenga salidas: si el día pedido no tiene, se muestran las próximas
  // y se avisa, en vez de responder «no encontramos rutas» a un día sin servicio.
  const fechaValida = date && dias.some((dia) => dia.key === date) ? date : "";
  const fechaSinSalidas = date && !fechaValida ? date : "";
  const tira = tiraDeDias(dias, fechaValida, DIAS_EN_TIRA);

  const routes = candidatas.map((route) => {
    const vigentes = fechaValida
      ? route.vigentes.filter((schedule) => scheduleDateKey(schedule.departureAt) === fechaValida)
      : route.vigentes;
    // El carril muestra las próximas salidas; el total sigue contando todas y en /reservar se eligen todas.
    // Con la temporada cargada eran ~600 tarjetas (~550 KB de HTML) en una pantalla de celular.
    return { ...route, schedules: vigentes.slice(0, RAIL_MAX_SCHEDULES), scheduleCount: vigentes.length };
  });

  function hrefConDia(dia: string) {
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (dia) query.set("date", dia);
    const cadena = query.toString();
    return cadena ? `/rutas?${cadena}` : "/rutas";
  }

  return (
    <>
      <main className="page-shell section">
        <div className="section-head">
          <div>
            <p className="eyebrow">{t.title}</p>
            <h1 className="section-title">{t.subtitle}</h1>
          </div>
          <Link className="button" href="#salidas">
            Buscar salidas
          </Link>
        </div>

        <form className="form-panel route-search-form" action="/rutas" method="get">
          <label>
            Origen
            <select name="from" defaultValue={from}>
              <option value="">{t.allOrigins}</option>
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
              <option value="">{t.allDestinations}</option>
              {destinations.map((destination) => (
                <option value={destination} key={destination}>
                  {destination}
                </option>
              ))}
            </select>
          </label>
          <input type="hidden" name="date" value={fechaValida} />
          <button className="button" type="submit">
            Buscar salidas
          </button>
          {dias.length ? (
          <div className="dia-field">
            <span className="dia-label">{t.days}</span>
            <div className="dia-tira" role="list">
              <Link
                className={`dia-chip ${fechaValida ? "" : "activo"}`}
                href={hrefConDia("")}
                aria-current={fechaValida ? undefined : "true"}
              >
                Todas
              </Link>
              {tira.map((dia) => (
                <Link
                  key={dia.key}
                  className={`dia-chip ${dia.key === fechaValida ? "activo" : ""}`}
                  href={hrefConDia(dia.key)}
                  aria-current={dia.key === fechaValida ? "true" : undefined}
                  title={`${dia.count} ${dia.count === 1 ? "salida" : "salidas"}`}
                >
                  {dia.label}
                </Link>
              ))}
            </div>
          </div>
          ) : null}

          {fechaSinSalidas ? (
            <p className="dia-aviso">
              <strong>No hay salidas el {formatScheduleDate(fechaDeClave(fechaSinSalidas))}.</strong>{" "}
              Te mostramos las próximas fechas disponibles.
            </p>
          ) : null}
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
                      <legend>{t.pickDeparture}</legend>
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
                     <button className="button" type="submit">{t.check} ↗</button>
                  </form>
                  <Link className="route-detail-link" href={`/rutas/${route.slug}`} prefetch={true}>
                    Ver detalles de la ruta
                  </Link>
                </div>
              </article>
            )) : <div className="empty-search-state"><strong>{t.empty}</strong><p>{t.emptyHint}</p><Link className="button" href={localizePath("/rutas", locale)}>{t.clear}</Link></div>}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
