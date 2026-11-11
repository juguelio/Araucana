import Link from "next/link";
import type { CSSProperties } from "react";
import { HistoricalMap } from "@/components/historical-map";
import { ServicesGrid } from "@/components/services-grid";
import { SiteFooter } from "@/components/site-footer";
import { getI18n } from "@/i18n/server";
import { localizePath } from "@/i18n/config";
import { listPublicRoutes } from "@/lib/booking/repository";
import { prisma } from "@/lib/db/prisma";
import laninSummer from "../../lanin-verano.webp";

export const revalidate = 300;
const whatsappUrl = "https://wa.me/5492944649049";

function todayDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Salta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function HomePage() {
  const { locale, dict } = await getI18n();
  const home = (path: string) => localizePath(path, locale);
  const routes = await listPublicRoutes();
  // El traslado al aeropuerto se reserva por vuelo: el home enlaza directo a cada sentido.
  const rutasAeropuerto = await prisma.travelRoute.findMany({
    where: { bookingMode: "AIRPORT", isActive: true },
    select: { slug: true, specialType: true }
  });
  const rutaAeropuerto = rutasAeropuerto.find((r) => r.specialType !== "DEPARTURE") ?? rutasAeropuerto[0] ?? null;
  const rutaAeropuertoVuelta = rutasAeropuerto.find((r) => r.specialType === "DEPARTURE") ?? null;
  const finalStyle = { "--final-image": `url(${laninSummer.src})` } as CSSProperties;
  const servicios = dict.services.items.map((item, index) => ({
    number: `0${index + 1}`,
    title: item.title,
    text: item.text,
    cta: [dict.services.book, dict.services.ask, dict.services.ask, dict.services.quote][index],
    href: [
      rutaAeropuerto ? `/reservar/${rutaAeropuerto.slug}` : "#chapelco",
      whatsappUrl,
      `${whatsappUrl}?text=${encodeURIComponent("Hola, quiero consultar por excursiones y destinos.")}`,
      `${whatsappUrl}?text=${encodeURIComponent("Hola, quiero consultar por un traslado grupal.")}`
    ][index],
    tone: ["service-green", "service-snow", "service-sky", "service-red"][index]
  }));

  return (
    <>
      <section className="new-hero">
        <video className="new-hero-video" autoPlay muted loop playsInline preload="metadata" poster="/hero-araucana-poster.webp" aria-hidden="true">
          <source src="/hero-araucana-movil.mp4" media="(max-width: 760px)" type="video/mp4" />
          <source src="/hero-araucana.mp4" type="video/mp4" />
        </video>
        <div className="new-hero-inner">
          <div className="new-hero-copy">
            <h1>{dict.hero.titleA}<br /><em>{dict.hero.titleB}</em></h1>
            <p className="new-hero-lead">{dict.hero.leadA}<br />{dict.hero.leadB}</p>
            <p className="new-hero-detail">{dict.hero.detail}</p>
            <div className="hero-actions">
              <Link className="accent-button" href={home("/rutas")} prefetch={true}>{dict.hero.cta} <span>↗</span></Link>
              <a className="hero-whatsapp-link" href={whatsappUrl} target="_blank" rel="noreferrer">{dict.nav.whatsapp} <span>↗</span></a>
            </div>
          </div>
          <div className="new-hero-badge"><span className="hero-note-dot" /> {dict.hero.badge} <strong>{dict.hero.badgeYear}</strong></div>
        </div>
      </section>
      <main>
        <section className="page-shell new-section service-showcase" id="servicios">
          <div className="section-head">
            <div><p className="eyebrow">{dict.services.eyebrow}</p><h2 className="section-title">{dict.services.titleA}<br /><span className="brand-green-text">{dict.services.titleB}</span></h2></div>
            <p className="lead section-intro">{dict.services.intro}</p>
          </div>
          <ServicesGrid services={servicios} />
        </section>

        <section className="chapelco-section page-shell" id="chapelco">
          <div className="chapelco-copy">
            <p className="eyebrow eyebrow-light">{dict.featured.eyebrow}</p>
            <h2>{dict.featured.titleA}<br />{dict.featured.titleB}<br /><em>{dict.featured.titleC}</em></h2>
            <p>{dict.featured.text}</p>
            <div className="route-pills">
              {rutaAeropuerto ? <Link href={home(`/reservar/${rutaAeropuerto.slug}`)} prefetch={true}>{dict.featured.fromAirport} <b>→</b> {dict.featured.fromAirportArrow}</Link> : <span>{dict.featured.fromAirport} <b>→</b> {dict.featured.fromAirportArrow}</span>}
              {rutaAeropuertoVuelta ? <Link href={home(`/reservar/${rutaAeropuertoVuelta.slug}`)} prefetch={true}>{dict.featured.toAirportArrow} <b>→</b> {dict.featured.toAirport}</Link> : <span>{dict.featured.toAirportArrow} <b>→</b> {dict.featured.toAirport}</span>}
            </div>
            <div className="chapelco-actions">
              {rutaAeropuerto ? <Link className="accent-button" href={home(`/reservar/${rutaAeropuerto.slug}`)} prefetch={true}>{dict.featured.ctaFlight} <span>↗</span></Link> : null}
              <Link className="cream-button" href={home("/rutas")} prefetch={true}>{dict.featured.ctaTransfer} <span>↗</span></Link>
            </div>
          </div>
          <form className="chapelco-form" action={home("/rutas")} method="get">
            <div className="booking-card-top"><span>{dict.featured.formTitle}</span><span className="status-dot">● {dict.featured.formStatus}</span></div>
            <label><small>{dict.featured.origin}</small><select name="from" defaultValue=""><option value="">{dict.featured.pickOrigin}</option>{Array.from(new Set(routes.map((route) => route.from))).map((origin) => <option value={origin} key={origin}>{origin}</option>)}</select></label>
            <label><small>{dict.featured.destination}</small><select name="to" defaultValue=""><option value="">{dict.featured.pickDestination}</option>{Array.from(new Set(routes.map((route) => route.to))).map((destination) => <option value={destination} key={destination}>{destination}</option>)}</select></label>
            <label><small>{dict.featured.date}</small><input type="date" name="date" defaultValue={todayDateKey()} /></label>
            <button className="accent-button" type="submit">{dict.featured.submit} ↗</button>
          </form>
        </section>

        <section className="page-shell new-section destination-section" id="destinos">
          <div className="section-head">
            <div><p className="eyebrow">{dict.destinations.eyebrow}</p><h2 className="section-title">{dict.destinations.titleA}<br /><span>{dict.destinations.titleB}</span></h2></div>
            <p className="lead section-intro">{dict.destinations.intro}</p>
          </div>
          <div className="destination-grid">
            {dict.destinations.items.map((item, index) => (
              <a className={`destination-card destination-${index + 1}`} href={whatsappUrl} target="_blank" rel="noreferrer" key={item.title}>
                <span className="destination-number">0{index + 1}</span>
                <span className="destination-shade" />
                <div><small>{item.detail}</small><h3>{item.title}</h3><span className="destination-link">{dict.destinations.cta} ↗</span></div>
              </a>
            ))}
          </div>
        </section>

        <section className="promise-section page-shell" id="nosotros">
          <div className="promise-image"><img src="/story-araucana.webp" alt={dict.promise.alt} loading="lazy" decoding="async" /></div>
          <div className="promise-copy">
            <p className="eyebrow">{dict.promise.eyebrow}</p>
            <h2 className="section-title">{dict.promise.titleA}<br /><span>{dict.promise.titleB}</span></h2>
            <p className="lead">{dict.promise.lead}</p>
            <p>{dict.promise.text} <strong>{dict.promise.quote}</strong></p>
            <div className="trust-list">{dict.promise.trust.map((item) => <span key={item}>{item}</span>)}</div>
          </div>
        </section>

        <section className="fleet-section page-shell">
          <div>
            <p className="eyebrow">{dict.fleet.eyebrow}</p>
            <h2 className="section-title">{dict.fleet.titleA}<br /><span>{dict.fleet.titleB}</span></h2>
            <p className="lead">{dict.fleet.lead}</p>
            <a className="text-link" href={whatsappUrl} target="_blank" rel="noreferrer">{dict.fleet.cta} ↗</a>
          </div>
          <div className="fleet-photo-card">
            <img src="/fleet-araucana-700.webp" alt={dict.fleet.alt} loading="lazy" decoding="async" />
            <div className="fleet-photo-caption"><span>{dict.fleet.captionSmall}</span><strong>{dict.fleet.captionBigA}<br />{dict.fleet.captionBigB}</strong></div>
          </div>
        </section>

        <section className="page-shell new-section map-section" id="mapa">
          <div className="section-head">
            <div><p className="eyebrow">{dict.map.eyebrow}</p><h2 className="section-title">{dict.map.titleA}<br /><span>{dict.map.titleB}</span></h2></div>
            <p className="lead section-intro">{dict.map.intro}</p>
          </div>
          <HistoricalMap />
        </section>

        <section className="trust-band page-shell">
          <div className="trust-badge">✓</div>
          <div><p className="eyebrow">{dict.trust.eyebrow}</p><h2>{dict.trust.title}</h2></div>
          <p>{dict.trust.text}</p>
        </section>

        <section className="final-image" style={finalStyle}>
          <div>
            <p className="eyebrow eyebrow-light">{dict.final.eyebrow}</p>
            <h2>{dict.final.titleA}<br />{dict.final.titleB} <em>{dict.final.accent}</em></h2>
            <Link className="cream-button" href={home("/rutas")} prefetch={true}>{dict.final.cta} <span>↗</span></Link>
          </div>
        </section>

        <section className="contact-section page-shell" id="contacto">
          <div className="contact-copy">
            <p className="eyebrow">{dict.contact.eyebrow}</p>
            <h2 className="section-title">{dict.contact.titleA}<br /><span>{dict.contact.titleB}</span></h2>
            <p className="lead">{dict.contact.lead}</p>
            <p className="address">{dict.contact.addressA}<br />{dict.contact.addressB}<br />{dict.contact.addressC}</p>
          </div>
          <div className="contact-card">
            <div>
              <small>{dict.contact.cardTitle}</small>
              <a href={whatsappUrl} target="_blank" rel="noreferrer" className="contact-whatsapp">WhatsApp +54 9 2944 64-9049 ↗</a>
              <a href="tel:+542972420285">02972 420285</a>
              <a href="mailto:info@araucana.com.ar">info@araucana.com.ar</a>
            </div>
            <div className="socials">
              <a href="https://www.instagram.com/" target="_blank" rel="noreferrer">{dict.contact.instagram} ↗</a>
              <a href="https://www.google.com/maps/search/?api=1&query=Mariano+Moreno+829+San+Martin+de+los+Andes" target="_blank" rel="noreferrer">{dict.contact.directions} ↗</a>
            </div>
          </div>
        </section>
      </main>
      <a className="floating-whatsapp" href={whatsappUrl} target="_blank" rel="noreferrer" aria-label={dict.nav.whatsapp}><span className="whatsapp-logo" aria-hidden="true"><svg viewBox="0 0 32 32" role="img"><circle cx="16" cy="16" r="16" fill="currentColor" /><path fill="#fff" d="M22.3 18.7c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1-.3-.2-1.3-.5-2.5-1.6-.9-.8-1.6-1.8-1.8-2.1-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.4.3-.6.1-.2 0-.5 0-.7-.1-.2-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.1 1.1-1.1 2.7 0 1.6 1.1 3.1 1.3 3.3.2.2 2.2 3.4 5.4 4.7.8.3 1.4.5 1.9.6.8.2 1.5.2 2 .1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.3-.6-.4ZM16 6.3a9.7 9.7 0 0 0-8.3 14.7L6.4 26l5.1-1.3A9.7 9.7 0 1 0 16 6.3Zm0 17.8c-1.6 0-3.1-.4-4.5-1.2l-.3-.2-3 .8.8-2.9-.2-.3a8.1 8.1 0 1 1 7.2 3.8Z" /></svg></span></a>
      <SiteFooter />
    </>
  );
}
