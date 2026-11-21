import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { getI18n } from "@/i18n/server";
import { localizePath } from "@/i18n/config";
import { PublicBookingSearch } from "@/components/public-booking-search";
import { getTripCatalog } from "@/lib/booking/public-trip-catalog";
import { airportSlugFromSelection } from "@/lib/booking/public-search";

export const revalidate = 300;

type RoutesPageProps = {
  searchParams?: Promise<{ from?: string; to?: string; date?: string; tramos?: string }>;
};

export default async function RoutesPage({ searchParams }: RoutesPageProps) {
  const { locale, dict } = await getI18n();
  const t = dict.routes;
  const params = await searchParams;
  const from = params?.from?.trim() ?? "";
  const to = params?.to?.trim() ?? "";
  const date = params?.date?.trim() ?? "";
  const idaYVuelta = params?.tramos?.trim() === "ida-y-vuelta";
  // Los tramos de aeropuerto se reservan por vuelo: elegirlos en el buscador lleva al flujo por vuelo.
  // Con «ida y vuelta» el buscador de la portada lleva al flujo que arma los dos tramos juntos.
  const airportSlug = airportSlugFromSelection(from) ?? airportSlugFromSelection(to);
  if (airportSlug) {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    const destino = idaYVuelta ? `/reservar/${airportSlug}/ida-y-vuelta${query}` : `/reservar/${airportSlug}${query}`;
    redirect(localizePath(destino, locale));
  }

  const catalog = await getTripCatalog();

  return (
    <>
      <main className="page-shell section">
        <div className="section-head">
          <div>
            <p className="eyebrow">{t.title}</p>
            <h1 className="section-title">{t.subtitle}</h1>
          </div>
        </div>
        <PublicBookingSearch catalog={catalog} locale={locale} query={params} />
        <section className="section" id="salidas">
          <div className="route-grid">
            {catalog.services.length ? catalog.services.map(({route}) => (
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
                    <span>{route.durationMin} min</span>
                    <span className="price">{route.priceCents > 0 ? new Intl.NumberFormat(locale === "es" ? "es-AR" : locale, {
                      style: "currency", currency: route.currency
                    }).format(route.priceCents / 100) : "Consultar"}</span>
                  </div>
                  <Link className="route-detail-link" href={localizePath(`/rutas/${route.slug}`, locale)} prefetch={true}>
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
