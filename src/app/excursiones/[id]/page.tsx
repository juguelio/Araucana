import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { getI18n } from "@/i18n/server";
import { LOCALE_TAGS, localizePath, type Locale } from "@/i18n/config";
import { getPublicExcursion } from "@/lib/excursions/repository";
import { formatExcursionDate } from "@/lib/excursions/validation";
import styles from "../excursiones.module.css";

export const dynamic = "force-dynamic";

const whatsappUrl = "https://wa.me/5492944649049";

type DetailCopy = {
  back: string; eyebrow: string; duration: string; price: string; askPrice: string;
  about: string; gallery: string; photo: string; openPhoto: string; departures: string;
  noDepartures: string; contact: string; askDate: string; inquiryNote: string;
  message: (name: string) => string; dateMessage: (name: string, date: string) => string;
};

const copy: Record<Locale, DetailCopy> = {
  es: {
    back: "Volver a excursiones", eyebrow: "Excursiones y destinos", duration: "Duración", price: "Precio", askPrice: "Consultar precio",
    about: "Sobre la excursión", gallery: "Fotos de la excursión", photo: "Foto", openPhoto: "Ampliar foto", departures: "Próximas salidas",
    noDepartures: "Consultanos por las próximas fechas.", contact: "Consultar por WhatsApp", askDate: "Consultar esta salida",
    inquiryNote: "Te ayudamos con los detalles y la disponibilidad por WhatsApp. Esta consulta no realiza una reserva.",
    message: (name) => `Hola, quiero consultar por la excursión «${name}».`,
    dateMessage: (name, date) => `Hola, quiero consultar por la excursión «${name}», para la salida del ${date}.`
  },
  en: {
    back: "Back to excursions", eyebrow: "Excursions and destinations", duration: "Duration", price: "Price", askPrice: "Ask about pricing",
    about: "About the excursion", gallery: "Excursion photos", photo: "Photo", openPhoto: "Enlarge photo", departures: "Upcoming departures",
    noDepartures: "Contact us for upcoming dates.", contact: "Ask on WhatsApp", askDate: "Ask about this departure",
    inquiryNote: "We’ll help you with details and availability on WhatsApp. Sending an inquiry does not make a booking.",
    message: (name) => `Hello, I’d like to ask about the excursion “${name}”.`,
    dateMessage: (name, date) => `Hello, I’d like to ask about the excursion “${name}”, departing on ${date}.`
  },
  pt: {
    back: "Voltar às excursões", eyebrow: "Excursões e destinos", duration: "Duração", price: "Preço", askPrice: "Consultar preço",
    about: "Sobre a excursão", gallery: "Fotos da excursão", photo: "Foto", openPhoto: "Ampliar foto", departures: "Próximas saídas",
    noDepartures: "Fale com a gente sobre as próximas datas.", contact: "Consultar pelo WhatsApp", askDate: "Consultar esta saída",
    inquiryNote: "Ajudamos você com os detalhes e a disponibilidade pelo WhatsApp. Esta consulta não realiza uma reserva.",
    message: (name) => `Olá, gostaria de saber mais sobre a excursão “${name}”.`,
    dateMessage: (name, date) => `Olá, gostaria de saber mais sobre a excursão “${name}”, com saída em ${date}.`
  }
};

export default async function ExcursionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale } = await getI18n();
  const now = new Date();
  const excursion = await getPublicExcursion(id, now);
  if (!excursion) notFound();

  const t = copy[locale];
  const departures = excursion.departures.filter((departure) => departure.departureAt >= now);
  const inquiryHref = `${whatsappUrl}?text=${encodeURIComponent(t.message(excursion.name))}`;

  return (
    <>
      <main className={`page-shell ${styles.page}`}>
        <Link className={styles.back} href={localizePath("/excursiones", locale)} prefetch={false}>← {t.back}</Link>
        <header className={styles.heading}>
          <p className="eyebrow">{t.eyebrow}</p>
          <h1 className={`section-title ${styles.detailTitle}`}>{excursion.name}</h1>
        </header>

        {excursion.photos.length ? (
          <section className={styles.gallery} aria-label={t.gallery}>
            {excursion.photos.map((photo, index) => (
              <a className={styles.galleryPhoto} href={`/excursiones/fotos/${photo.id}`} key={photo.id} aria-label={`${t.openPhoto} ${index + 1}: ${excursion.name}`}>
                <img src={`/excursiones/fotos/${photo.id}`} alt={`${excursion.name} · ${t.photo} ${index + 1}`} width={960} height={640} loading={index === 0 ? "eager" : "lazy"} decoding="async" />
              </a>
            ))}
          </section>
        ) : null}

        <div className={styles.detailGrid}>
          <section className={styles.description} aria-labelledby="sobre-excursion">
            <h2 id="sobre-excursion" className={styles.subheading}>{t.about}</h2>
            <p>{excursion.description}</p>
          </section>
          <aside className={styles.inquiry}>
            <dl className={styles.facts}>
              <div><dt>{t.duration}</dt><dd>{excursion.duration}</dd></div>
              <div><dt>{t.price}</dt><dd>{excursion.priceCents === null ? t.askPrice : new Intl.NumberFormat(LOCALE_TAGS[locale], { style: "currency", currency: excursion.currency, currencyDisplay: "code" }).format(excursion.priceCents / 100)}</dd></div>
            </dl>
            <a className={`button ${styles.contact}`} href={inquiryHref} target="_blank" rel="noopener noreferrer">{t.contact} <span aria-hidden="true">↗</span></a>
            <p className={styles.note}>{t.inquiryNote}</p>
          </aside>
        </div>

        <section className={styles.departures} id="salidas" aria-labelledby="proximas-salidas">
          <h2 id="proximas-salidas" className={styles.subheading}>{t.departures}</h2>
          {departures.length ? (
            <ul className={styles.departureList}>
              {departures.map((departure) => {
                const label = formatExcursionDate(departure.departureAt, locale);
                return (
                  <li key={departure.id}>
                    <time dateTime={departure.departureAt.toISOString()}>{label}</time>
                    <a className={`ghost-button ${styles.dateAction}`} href={`${whatsappUrl}?text=${encodeURIComponent(t.dateMessage(excursion.name, label))}`} target="_blank" rel="noopener noreferrer" aria-label={`${t.askDate}: ${label}`}>{t.askDate} <span aria-hidden="true">↗</span></a>
                  </li>
                );
              })}
            </ul>
          ) : <p className={styles.note}>{t.noDepartures}</p>}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
