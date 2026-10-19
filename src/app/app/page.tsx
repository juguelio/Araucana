import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { listPublicRoutes, listSchedulesForRoute } from "@/lib/booking/repository";

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Salta"
  }).format(date);
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

export default async function AppFlowPage() {
  const routes = await listPublicRoutes();
  const route = routes.find((item) => item.featured) ?? routes[0];
  const schedules = route ? await listSchedulesForRoute(route.id) : [];
  const nextSchedule = schedules[0];
  const previewRoute = route ? `${route.from} -> ${route.to}` : "Ruta sin publicar";
  const previewSchedule = nextSchedule ? formatDateTime(nextSchedule.departureAt) : "Sin salidas";
  const previewPrice = route ? formatPrice(route.priceCents, route.currency) : "Consultar";

  return (
    <>
      <main className="page-shell section">
        <div className="split">
          <div>
            <p className="eyebrow">Flujo mobile-compatible</p>
            <h1 className="section-title">Buscar → detalle → cupo → reserva.</h1>
            <p className="lead">
              Esta pantalla deja conectado el recorrido que despues vamos a
              convertir en SwiftUI y Android usando la misma API.
            </p>
            <div className="inline-actions">
              <Link className="button" href="/rutas">
                Buscar viaje
              </Link>
              <Link className="ghost-button" href="/login">
                Entrar admin
              </Link>
            </div>
          </div>
          <div className="mobile-preview">
            <div className="phone-card">
              <div className="ticket-preview">
                <p className="eyebrow">Paso 2 de 4</p>
                <h2>Elegí tu salida</h2>
                <p>
                  {previewRoute} · {previewSchedule}
                </p>
                <p className="price">{previewPrice}</p>
              </div>
            </div>
          </div>
        </div>

        <section className="section">
          <div className="stats-grid">
            {[
              ["1", "Buscar", "Origen, destino, fecha y pasajeros"],
              ["2", "Detalle", "Ruta, paradas, duracion y precio"],
              ["3", "Cupo", "Lugares disponibles, sin numeración"],
              ["4", "Reserva", "Ticket QR y seguimiento"]
            ].map(([num, title, text]) => (
              <div className="stat-card" key={title}>
                <strong>{num}</strong>
                <span>{title}</span>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
