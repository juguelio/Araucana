import Link from "next/link";
import { localizePath } from "@/i18n/config";
import { getI18n } from "@/i18n/server";

export async function SiteFooter() {
  const { locale, dict } = await getI18n();
  const f = dict.footer;
  const links = [
    { label: f.transfers, href: "/rutas" },
    { label: f.services, href: "/#servicios" },
    { label: f.destinations, href: "/#destinos" },
    { label: f.contact, href: "/#contacto" },
    { label: f.support, href: "/soporte" },
    { label: f.terms, href: "/terminos" },
    { label: f.privacy, href: "/privacidad" }
  ];
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="brand-lockup"><img className="footer-logo" src="/logo.webp" alt={f.logoAlt} /><span className="brand-kicker">{f.kicker}</span></div>
        <div className="split">
          <p className="lead">{f.address}<br />{f.postal}<br /><a href="tel:+542972420285">02972 420285</a> · <a href="mailto:info@araucana.com.ar">info@araucana.com.ar</a></p>
          <div className="footer-links">{links.map((link) => <Link href={localizePath(link.href, locale)} key={link.href}>{link.label}</Link>)}<a href="/login">{f.login}</a><a href="https://wa.me/5492944649049">WhatsApp</a><a href="https://www.instagram.com/">Instagram</a></div>
        </div>
        <p className="muted">{f.legal}</p>
      </div>
    </footer>
  );
}
