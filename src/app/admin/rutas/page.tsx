import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { listAdminRoutes } from "@/lib/booking/repository";
import { deleteRouteAction, setRouteActiveAction } from "./actions";
import "./rutas.css";

const MODO_LABEL: Record<string, string> = { AIRPORT: "Aeropuerto", REGULAR: "Regular" };

type AdminRoutesPageProps = {
  searchParams?: Promise<{
    notice?: string;
  }>;
};

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

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (!hours) {
    return `${remainder} min`;
  }

  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

export default async function AdminRoutesPage({ searchParams }: AdminRoutesPageProps) {
  await getCurrentAdminOrRedirect();
  const params = await searchParams;
  const routes = await listAdminRoutes();
  const activas = routes.filter((r) => r.isActive);
  // Lo que conviene revisar antes de que un pasajero lo encuentre: una ruta activa sin precio se vende
  // en $0 y una activa sin salidas no aparece en la web. Son los mismos campos de la tabla, sumados.
  const sinPrecio = activas.filter((r) => r.priceCents <= 0 && r.bookingMode !== "AIRPORT");
  const sinSalidas = activas.filter((r) => r.scheduleCount === 0 && r.bookingMode !== "AIRPORT");

  return (
    <AdminShell
      title="Rutas"
      notice={params?.notice}
      action={
        <div className="inline-actions">
          <Link className="ghost-button" href="/rutas">Ver publico</Link>
          <Link className="button" href="/admin/rutas/nueva">Agregar ruta</Link>
        </div>
      }
    >
      <section className="admin-grid rutas-stats">
        <div className="admin-card">
          <span className="muted">Rutas activas</span>
          <strong>{activas.length}</strong>
          <span className="muted">de {routes.length}</span>
        </div>
        <div className="admin-card" data-alerta={sinPrecio.length > 0 || undefined}>
          <span className="muted">Activas sin precio</span>
          <strong>{sinPrecio.length}</strong>
          <span className="muted">{sinPrecio.length > 0 ? "se venden en «Consultar»" : "todas con precio"}</span>
        </div>
        <div className="admin-card" data-alerta={sinSalidas.length > 0 || undefined}>
          <span className="muted">Activas sin salidas</span>
          <strong>{sinSalidas.length}</strong>
          <span className="muted">{sinSalidas.length > 0 ? "no aparecen en la web" : "todas con salidas"}</span>
        </div>
      </section>

      <div className="table-scroll rutas-tabla-scroll">
      <table className="data-table rutas-tabla">
        <thead>
          <tr>
            <th>Ruta</th>
            <th>Vía</th>
            <th>Duración</th>
            <th>Precio</th>
            <th>Estado</th>
            <th>Salidas</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((route) => {
            const esAeropuerto = route.bookingMode === "AIRPORT";
            const avisoPrecio = route.isActive && !esAeropuerto && route.priceCents <= 0;
            const avisoSalidas = route.isActive && !esAeropuerto && route.scheduleCount === 0;
            return (
            <tr key={route.id} data-inactiva={!route.isActive || undefined} data-aviso={avisoPrecio || avisoSalidas || undefined}>
              <td data-label="Ruta">
                <strong className="rutas-nombre">{route.from} → {route.to}</strong>
                <span className="rutas-meta">
                  {esAeropuerto ? <span className="pill pill-estado rutas-modo">{MODO_LABEL[route.bookingMode] ?? route.bookingMode}</span> : null}
                  {route.featured ? <span className="pill pill-estado rutas-modo" data-tono="ok">Destacada</span> : null}
                  <span className="muted">{route.category}</span>
                </span>
              </td>
              <td data-label="Vía">{route.via}</td>
              <td data-label="Duración">{formatDuration(route.durationMin)}</td>
              <td data-label="Precio">
                {avisoPrecio ? <span className="pill pill-estado" data-tono="atencion">Consultar · sin precio</span> : formatPrice(route.priceCents, route.currency)}
              </td>
              <td data-label="Estado">
                <span className={`status-pill ${route.isActive ? "active" : "inactive"}`}>
                  {route.isActive ? "Activa" : "Inactiva"}
                </span>
              </td>
              <td data-label="Salidas">
                {esAeropuerto ? (
                  <span className="muted">por vuelo</span>
                ) : avisoSalidas ? (
                  <span className="pill pill-estado" data-tono="atencion">sin salidas</span>
                ) : (
                  <Link className="table-link" href={`/admin/rutas/${route.id}/salidas`}>{route.scheduleCount}</Link>
                )}
              </td>
              <td data-label="Acciones">
                <div className="table-actions">
                  <Link className="button" href={`/admin/rutas/${route.id}/salidas`}>Ver salidas</Link>
                  <Link className="ghost-button" href={`/admin/rutas/${route.id}`}>Editar</Link>
                  <form action={setRouteActiveAction}>
                    <input type="hidden" name="id" value={route.id} />
                    <input type="hidden" name="isActive" value={route.isActive ? "false" : "true"} />
                    <button className="ghost-button" type="submit">
                      {route.isActive ? "Inactivar" : "Activar"}
                    </button>
                  </form>
                  <form action={deleteRouteAction}>
                    <input type="hidden" name="id" value={route.id} />
                    <button className="danger-button" type="submit">Borrar</button>
                  </form>
                </div>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </AdminShell>
  );
}
