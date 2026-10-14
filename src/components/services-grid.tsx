import Link from "next/link";
import { ServiceCardVideo } from "@/components/service-card-video";

type Service = { number: string; title: string; text: string; href: string; tone: string };

export function ServicesGrid({ services }: { services: Service[] }) {
  return <div className="services-grid new-services-grid">{services.map((service) => {
    const external = service.href.startsWith("http");
    const content = <><span className="service-number">{service.number}</span><span className="service-arrow">↗</span><span className="service-icon">{service.number === "01" ? "⌁" : service.number === "02" ? "✦" : service.number === "03" ? "◌" : "＋"}</span><h3>{service.title}</h3><p>{service.text}</p><span className="service-cta">{service.number === "01" ? "Reservar" : service.number === "04" ? "Cotizar servicio" : "Consultar"} ↗</span></>;
    const video = service.number === "01" ? <ServiceCardVideo /> : null;
    return external ? <a className={`service-card ${service.tone}`} href={service.href} target="_blank" rel="noreferrer" key={service.number}>{video}{content}</a> : <Link className={`service-card ${service.tone}`} href={service.href} key={service.number}>{video}{content}</Link>;
  })}</div>;
}
