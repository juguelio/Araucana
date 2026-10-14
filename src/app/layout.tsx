import type { Metadata } from "next";
import Link from "next/link";
import { Poppins } from "next/font/google";
import { BrandMark } from "@/components/brand-mark";
import { MobileNav } from "@/components/mobile-nav";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-poppins"
});

export const metadata: Metadata = {
  title: "La Araucana | Agencia de viajes desde 2009",
  description: "Viajes, traslados y experiencias en la Patagonia Argentina."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={poppins.variable}>
        <header className="site-header">
          <nav className="site-nav">
            <Link className="brand-link" href="/" id="inicio">
              <img className="brand-logo" src="/logo.png" alt="La Araucana Viajes" />
              <span className="brand-kicker">Agencia de viajes desde 2009</span>
            </Link>
            <div className="nav-links">
              <Link href="#inicio">Inicio</Link><Link href="/rutas" prefetch={true}>Traslados</Link><Link href="#servicios">Servicios</Link><Link href="#destinos">Destinos</Link><Link href="#contacto">Grupos y empresas</Link><Link href="#nosotros">Nosotros</Link><Link href="#contacto">Contacto</Link>
            </div>
            <div className="nav-actions">
              <Link className="text-link" href="/login">Acceso</Link>
              <Link className="cream-button" href="/rutas" prefetch={true}>
                Reservar
              </Link>
              <MobileNav />
            </div>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
