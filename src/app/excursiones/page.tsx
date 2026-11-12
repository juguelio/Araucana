import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { getI18n } from "@/i18n/server";
import { LOCALE_TAGS, localizePath, type Locale } from "@/i18n/config";
import { listPublicExcursions } from "@/lib/excursions/repository";
import { formatExcursionDate } from "@/lib/excursions/validation";
import styles from "./excursiones.module.css";

// Se consulta por pedido: no acceder a tablas nuevas durante el build ni conservar salidas pasadas.
export const dynamic = "force-dynamic";

const whatsappUrl = "https://wa.me/5492944649049";

type CatalogCopy = {
  title: string; intro: string; duration: string; price: string; askPrice: string;
  departures: string; noDepartures: string; detail: string; moreDates: string;
  empty: string; emptyHint: string; contact: string;
};

const copy: Record<Locale, CatalogCopy> = {
  es: {
    title: "Excursiones y destinos", intro: "Conocé nuestras excursiones y las próximas salidas. Consultanos por WhatsApp para planificar tu viaje.",
    duration: "Duración", price: "Precio", askPrice: "Consultar precio", departures: "Próximas salidas",
    noDepartures: "Consultanos por las próximas fechas.", detail: "Ver excursión", moreDates: "Ver todas las fechas",
    empty: "Estamos preparando nuevas excursiones.", emptyHint: "Pronto vas a encontrar acá nuestros destinos y próximas salidas. Mientras tanto, escribinos y te ayudamos a planificar tu viaje.",
    contact: "Consultar por WhatsApp"
  },
  en: {
    title: "Excursions and destinations", intro: "Explore our excursions and upcoming departures. Contact us on WhatsApp to plan your trip.",
    duration: "Duration", price: "Price", askPrice: "Ask about pricing", departures: "Upcoming departures",
    noDepartures: "Contact us for upcoming dates.", detail: "View excursion", moreDates: "View all dates",
    empty: "We’re preparing new excursions.", emptyHint: "Our destinations and upcoming departures will appear here soon. In the meantime, message us and we’ll help you plan your trip.",
    contact: "Ask on WhatsApp"
  },
  pt: {
    title: "Excursões e destinos", intro: "Conheça nossas excursões e próximas saídas. Fale com a gente pelo WhatsApp para planejar sua viagem.",
    duration: "Duração", price: "Preço", askPrice: "Consultar preço", departures: "Próximas saídas",
    noDepartures: "Fale com a gente sobre as próximas datas.", detail: "Ver excursão", moreDates: "Ver todas as datas",
    empty: "Estamos preparando novas excursões.", emptyHint: "Em breve você encontrará aqui nossos destinos e próximas saídas. Enquanto isso, fale com a gente para planejar sua viagem.",
    contact: "Consultar pelo WhatsApp"
  }
};

export default async function ExcursionsPage() {
  const { locale } = await getI18n();
  const t = copy[locale];
  const now = new Date();
  const excursions = await listPublicExcursions(now);

  return (
    <>
      <main className={`page-shell ${styles.page}`}>
        <header className={styles.heading}>
          <p className="eyebrow">La Araucana Viajes</p>
          <h1 className="section-title">{t.title}</h1>
          <p className={`lead ${styles.intro}`}>{t.intro}</p>
        </header>

        {excursions.length ? (
          <div className={styles.grid}>
            {excursions.map((excursion) => {
              const href = localizePath(`/excursiones/${excursion.id}`, locale);
              const photo = excursion.photos[0];
              const departures = excursion.departures.filter((departure) => departure.departureAt >= now);
              return (
                <article className={styles.card} key={excursion.id}>
                  {photo ? (
                    <Link className={styles.cover} href={href} tabIndex={-1} aria-hidden="true" prefetch={false}>
                      <img src={`/excursiones/fotos/${photo.id}`} alt="" width={720} height={450} loading="lazy" decoding="async" />
                    </Link>
                  ) : null}
                  <div className={styles.cardBody}>
                    <h2 className={styles.cardTitle}><Link href={href} prefetch={false}>{excursion.name}</Link></h2>
                    <p className={styles.summary}>{excursion.description}</p>
                    <dl className={styles.facts}>
                      <div><dt>{t.duration}</dt><dd>{excursion.duration}</dd></div>
                      <div><dt>{t.price}</dt><dd>{excursion.priceCents === null ? t.askPrice : new Intl.NumberFormat(LOCALE_TAGS[locale], { style: "currency", currency: excursion.currency, currencyDisplay: "code" }).format(excursion.priceCents / 100)}</dd></div>
                    </dl>
                    <div className={styles.cardDepartures}>
                      <h3>{t.departures}</h3>
                      {departures.length ? (
                        <ul className={styles.dateList}>
                          {departures.slice(0, 3).map((departure) => (
                            <li key={departure.id}><time dateTime={departure.departureAt.toISOString()}>{formatExcursionDate(departure.departureAt, locale)}</time></li>
                          ))}
                        </ul>
                      ) : <p className={styles.note}>{t.noDepartures}</p>}
                      {departures.length > 3 ? <Link className={styles.textLink} href={`${href}#salidas`} prefetch={false}>{t.moreDates} →</Link> : null}
                    </div>
                    <Link className={`button ${styles.cardAction}`} href={href} prefetch={false}>{t.detail} <span aria-hidden="true">↗</span></Link>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <section className={styles.empty}>
            <h2>{t.empty}</h2>
            <p>{t.emptyHint}</p>
            <a className="button" href={whatsappUrl} target="_blank" rel="noopener noreferrer">{t.contact} <span aria-hidden="true">↗</span></a>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
