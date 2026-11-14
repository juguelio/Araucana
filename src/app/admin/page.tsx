import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { formatCurrency } from "@/lib/admin/salary";
import { countAdminReservations, listPublicRoutes } from "@/lib/booking/repository";
import { getAdminOperationsSummary, type AdminReceiptRow } from "@/lib/booking/operations";
import { LogoutButton } from "./logout-button";
import "./panel.css";

type AdminPageProps = {
  searchParams?: Promise<{
    notice?: string;
  }>;
};

const cuando = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Salta"
});

function FilaComprobante({ item }: { item: AdminReceiptRow }) {
  return (
    <li>
      {/* Cada fila abre la reserva: antes había que ir a la lista y buscarla por el código. */}
      <Link className="panel-item-main" href={`/admin/reservas/${item.code}`}>
        {item.passenger}
        <span className="panel-item-code">{item.code}</span>
      </Link>
      <span className="panel-item-meta">
        {formatCurrency(item.amountCents, item.currency)}
        {item.uploadedAt ? ` · subido ${cuando.format(item.uploadedAt)}` : ""}
      </span>
    </li>
  );
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const user = await getCurrentAdminOrRedirect();
  const params = await searchParams;
  const [routes, reservationCount, operaciones] = await Promise.all([
    listPublicRoutes(),
    countAdminReservations(),
    getAdminOperationsSummary()
  ]);

  const { receiptsPending, receiptsRejected, upcomingDepartures, flightsWithoutVehicle } = operaciones;
  const pendientes = receiptsPending.count + receiptsRejected.count;

  return (
    <AdminShell title="Panel" eyebrow="Gestión comercial y operativa" action={<LogoutButton />} notice={params?.notice}>
      <p className="panel-session muted">Sesión de {user.email}</p>

      {/* Lo que se abre todos los días, a un toque. Son enlaces a pantallas que ya existen. */}
      <nav className="panel-quick" aria-label="Accesos rápidos">
        <Link className="panel-quick-link" href="/admin/aeropuerto">
          <strong>Vuelos de hoy</strong>
          <span>{flightsWithoutVehicle === 0 ? "Todos con unidad" : `${flightsWithoutVehicle} sin unidad`}</span>
        </Link>
        <Link className="panel-quick-link" href="/admin/aeropuerto/reservar">
          <strong>Reserva de aeropuerto</strong>
          <span>Un tramo o ida y vuelta</span>
        </Link>
        <Link className="panel-quick-link" href="/admin/reservas?payment=receipt-pending" data-alerta={receiptsPending.count > 0 || undefined}>
          <strong>Comprobantes por validar</strong>
          <span>{receiptsPending.count === 0 ? "Nada pendiente" : `${receiptsPending.count} esperando`}</span>
        </Link>
        <Link className="panel-quick-link" href="/admin/reservas/nueva">
          <strong>Crear reserva</strong>
          <span>Salidas regulares</span>
        </Link>
      </nav>

      <section className="admin-grid panel-stats">
        <Link className="admin-card panel-stat" href="/admin/rutas">
          <span className="muted">Rutas publicadas</span>
          <strong>{routes.length}</strong>
        </Link>
        <Link className="admin-card panel-stat" href="/admin/reservas">
          <span className="muted">Reservas registradas</span>
          <strong>{reservationCount}</strong>
        </Link>
        <Link className="admin-card panel-stat" href="/admin/aeropuerto" data-alerta={flightsWithoutVehicle > 0 || undefined}>
          <span className="muted">Vuelos sin unidad</span>
          <strong>{flightsWithoutVehicle}</strong>
        </Link>
      </section>

      <section className="panel-section">
        <div className="panel-section-head">
          <h2>Cobros</h2>
          <p>{pendientes === 0 ? "Nada pendiente en este momento." : `${pendientes} ${pendientes === 1 ? "reserva espera" : "reservas esperan"} una respuesta.`}</p>
        </div>

        <div className="panel-queues">
          <article className="admin-card panel-queue">
            <header className="panel-queue-head">
              <span className="muted">Comprobantes por validar</span>
              <strong className={receiptsPending.count > 0 ? "panel-count is-pending" : "panel-count"}>{receiptsPending.count}</strong>
            </header>
            {receiptsPending.items.length ? (
              <ul className="panel-list">
                {receiptsPending.items.map((item) => (
                  <FilaComprobante item={item} key={item.code} />
                ))}
              </ul>
            ) : (
              <p className="panel-empty">Sin comprobantes esperando validación.</p>
            )}
            <Link className="panel-link" href="/admin/reservas?payment=receipt-pending">
              Ver la lista{receiptsPending.count > receiptsPending.items.length ? ` (${receiptsPending.count})` : ""} →
            </Link>
          </article>

          <article className="admin-card panel-queue">
            <header className="panel-queue-head">
              <span className="muted">Comprobantes rechazados</span>
              <strong className={receiptsRejected.count > 0 ? "panel-count is-rejected" : "panel-count"}>{receiptsRejected.count}</strong>
            </header>
            {receiptsRejected.items.length ? (
              <ul className="panel-list">
                {receiptsRejected.items.map((item) => (
                  <FilaComprobante item={item} key={item.code} />
                ))}
              </ul>
            ) : (
              <p className="panel-empty">Ningún comprobante rechazado.</p>
            )}
            <Link className="panel-link" href="/admin/reservas?payment=rejected">
              Ver la lista{receiptsRejected.count > receiptsRejected.items.length ? ` (${receiptsRejected.count})` : ""} →
            </Link>
          </article>
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-section-head">
          <h2>Próximas salidas</h2>
          <p>Ocupados sobre los asientos de cada unidad, sin contar reservas canceladas.</p>
        </div>

        <article className="admin-card panel-departures">
          {upcomingDepartures.length ? (
            <ul className="panel-list">
              {upcomingDepartures.map((departure) => (
                <li key={departure.id}>
                  <span className="panel-when">{cuando.format(departure.departureAt)}</span>
                  <span className="panel-item-main">
                    {departure.routeLabel} · {departure.vehicle}
                  </span>
                  <span className={departure.occupied >= departure.capacity ? "panel-seats is-full" : "panel-seats"}>
                    {departure.occupied}/{departure.capacity}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="panel-empty">No hay salidas cargadas para los próximos días.</p>
          )}
          <Link className="panel-link" href="/admin/rutas">
            Gestionar rutas y salidas →
          </Link>
        </article>
      </section>
    </AdminShell>
  );
}
