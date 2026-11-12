import Link from "next/link";
import { ServiceCardVideo } from "@/components/service-card-video";
import { getI18n } from "@/i18n/server";
import { localizePath, type Locale } from "@/i18n/config";

const excursionCta: Record<Locale, string> = { es: "Ver excursiones", en: "View excursions", pt: "Ver excursões" };

type Service = { number: string; title: string; text: string; cta: string; href: string; tone: string };

export async function ServicesGrid({ services }: { services: Service[] }) {
  const { locale } = await getI18n();
  return <div className="services-grid new-services-grid">{services.map((service) => {
    // El servicio 03 es la vidriera de excursiones en los tres idiomas.
    const href = service.number === "03" ? localizePath("/excursiones", locale) : service.href;
    const cta = service.number === "03" ? excursionCta[locale] : service.cta;
    const external = href.startsWith("http");
    const content = <><span className="service-number">{service.number}</span><span className="service-arrow">↗</span><span className="service-icon">{service.number === "01" ? "⌁" : service.number === "02" ? "✦" : service.number === "03" ? "◌" : "＋"}</span><h3>{service.title}</h3><p>{service.text}</p><span className="service-cta">{cta} ↗</span></>;
    const video = service.number === "01" ? <ServiceCardVideo /> : null;
    return external ? <a className={`service-card ${service.tone}`} href={href} target="_blank" rel="noreferrer" key={service.number}>{video}{content}</a> : <Link className={`service-card ${service.tone}`} href={href} key={service.number}>{video}{content}</Link>;
  })}</div>;
}
