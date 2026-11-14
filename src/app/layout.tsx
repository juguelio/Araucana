import type { Metadata } from "next";
import Link from "next/link";
import { Poppins } from "next/font/google";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { MobileNav } from "@/components/mobile-nav";
import { WeatherChip } from "@/components/weather-chip";
import { WebVitals } from "@/components/web-vitals";
import { currentPath, getI18n } from "@/i18n/server";
import { LOCALE_TAGS, localizePath, type Locale } from "@/i18n/config";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-poppins"
});

/** Metadatos y `hreflang` por idioma: la misma página declarada en ES, EN y PT. */
export async function generateMetadata(): Promise<Metadata> {
  const { locale, dict } = await getI18n();
  const path = await currentPath();
  const languages = Object.fromEntries(
    (Object.keys(LOCALE_TAGS) as Locale[]).map((item) => [LOCALE_TAGS[item], localizePath(path, item)])
  );

  return {
    title: dict.meta.title,
    description: dict.meta.description,
    alternates: { canonical: localizePath(path, locale), languages },
    openGraph: { locale: LOCALE_TAGS[locale], title: dict.meta.title, description: dict.meta.description }
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { locale, dict } = await getI18n();
  const nav = dict.nav;
  const links = [
    { label: nav.home, href: "/" },
    { label: nav.transfers, href: "/rutas" },
    { label: nav.services, href: "/#servicios" },
    { label: nav.destinations, href: "/#destinos" },
    { label: nav.groups, href: "/#contacto" },
    { label: nav.about, href: "/#nosotros" },
    { label: nav.contact, href: "/#contacto" }
  ];

  return (
    <html lang={LOCALE_TAGS[locale]}>
      <body className={poppins.variable}>
        <header className="site-header">
          <nav className="site-nav">
            <Link className="brand-link" href={localizePath("/", locale)} id="inicio">
              <img className="brand-logo" src="/logo.webp" alt={dict.footer.logoAlt} />
              <span className="brand-kicker">{dict.footer.kicker}</span>
            </Link>
            <WeatherChip />
            <div className="nav-links">
              {links.map((link) => (
                <Link href={localizePath(link.href, locale)} prefetch={true} key={`${link.href}:${link.label}`}>
                  {link.label}
                </Link>
              ))}
            </div>
            <div className="nav-actions">
              <LanguageSwitcher label={dict.lang.label} switchTo={dict.lang.switchTo} />
              <a className="text-link" href="/login">{nav.login}</a>
              <Link className="cream-button" href={localizePath("/rutas", locale)} prefetch={true}>
                {nav.book}
              </Link>
              <MobileNav items={links.map((link) => ({ label: link.label, href: localizePath(link.href, locale) }))} labels={{ open: nav.menuOpen, close: nav.menuClose, menu: nav.menuLabel, whatsapp: "WhatsApp", language: dict.lang.label, switchTo: dict.lang.switchTo }} />
            </div>
          </nav>
        </header>
        {children}
        <WebVitals />
      </body>
    </html>
  );
}
