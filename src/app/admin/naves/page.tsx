import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { VEHICLE_TEMPLATES } from "@/lib/vehicles/templates";
import { complianceLabel, formatoFecha, peorVencimiento, resumenVencimientos, vencimientosOrdenados } from "@/lib/vehicles/compliance";
import {
  ariaSort,
  hrefDeOrden,
  hrefDePagina,
  leerOrdenDelListado,
  ordenarNaves,
  paginarNaves,
  type ColumnaNaves
} from "@/lib/vehicles/fleet-table";
import { VencimientosDialog } from "./vencimientos-dialog";
import "./naves.css";
import "../reservas/pagination.css";

type AdminVehiclesPageProps = {
  searchParams?: Promise<{
    notice?: string;
    orden?: string;
    dir?: string;
    page?: string;
  }>;
};

const TIPO_LABEL: Record<string, string> = { CAMIONETA: "Camioneta", BUS: "Bus", UTILITARIO: "Utilitario" };

/** Las columnas de la tabla, en orden. Todas se ordenan menos «Acciones». */
const COLUMNAS: Array<{ columna: ColumnaNaves; titulo: string }> = [
  { columna: "unidad", titulo: "Unidad" },
  { columna: "vehiculo", titulo: "Marca / modelo · patente" },
  { columna: "anio", titulo: "Año" },
  { columna: "titular", titulo: "Titular" },
  { columna: "seguro", titulo: "Seguro" },
  { columna: "vencimientos", titulo: "Vencimientos" },
  { columna: "capacidad", titulo: "Capacidad" },
  { columna: "estado", titulo: "Estado" }
];

export default async function AdminVehiclesPage({ searchParams }: AdminVehiclesPageProps) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const params = await searchParams;
  const hoy = new Date();
  const orden = leerOrdenDelListado(params);
  const flota = await prisma.vehicle.findMany({
    orderBy: [{ isActive: "desc" }, { internalNumber: "asc" }, { name: "asc" }],
    include: {
      _count: {
        select: {
          seats: true,
          schedules: true,
          scheduleUnits: true
        }
      }
    }
  });
  const activeVehicles = flota.filter((vehicle) => vehicle.isActive);
  const publicos = flota.filter((vehicle) => vehicle.publicTransport);
  const totalSeats = flota.reduce((total, vehicle) => total + vehicle._count.seats, 0);
  const resumen = resumenVencimientos(flota, hoy);
  // Los vencimientos se ven por nave: el botón de cada fila abre su detalle. Ordenar por la
  // columna «Vencimientos» deja arriba las unidades con papeles vencidos o por vencer.
  const ordenadas = ordenarNaves(flota.map((vehicle) => ({ ...vehicle, asientos: vehicle._count.seats })), orden.orden, orden.dir, hoy);
  const pagina = paginarNaves(ordenadas, orden.page);
  const vehicles = pagina.items;

  return (
    <AdminShell role={sessionUser.role}
      title="Naves"
      notice={params?.notice}
      action={<Link className="button" href="/admin/naves/nueva">Agregar nave</Link>}
    >
      <section className="admin-grid naves-stats">
        <div className="admin-card">
          <span className="muted">Naves activas</span>
          <strong>{activeVehicles.length}</strong>
        </div>
        <div className="admin-card">
          <span className="muted">Transporte público</span>
          <strong>{publicos.length}</strong>
        </div>
        <div className="admin-card">
          <span className="muted">Asientos cargados</span>
          <strong>{totalSeats}</strong>
        </div>
        <Link
          className="admin-card naves-stat-link"
          href={hrefDeOrden({ orden: null, dir: "asc", page: 1 }, "vencimientos")}
          data-alerta={resumen.vencidos > 0 || undefined}
          title="Ordenar el listado por vencimientos"
        >
          <span className="muted">Papeles vencidos / por vencer</span>
          <strong>
            {resumen.vencidos} / {resumen.proximos}
          </strong>
        </Link>
      </section>

      <form className="naves-orden-movil" method="get" action="/admin/naves" aria-label="Ordenar naves">
        <label>
          Ordenar por
          <select name="orden" defaultValue={orden.orden ?? ""}>
            <option value="">Activas primero</option>
            {COLUMNAS.map(({ columna, titulo }) => (
              <option key={columna} value={columna}>{titulo}</option>
            ))}
          </select>
        </label>
        <label>
          Sentido
          <select name="dir" defaultValue={orden.dir}>
            <option value="asc">Ascendente</option>
            <option value="desc">Descendente</option>
          </select>
        </label>
        <button className="ghost-button" type="submit">Ordenar</button>
      </form>

      <div className="table-scroll naves-tabla-scroll">
        <table className="data-table naves-tabla">
          <thead>
            <tr>
              {COLUMNAS.map(({ columna, titulo }) => {
                const sentido = ariaSort(orden, columna);
                return (
                  <th key={columna} aria-sort={sentido}>
                    <Link className="naves-orden" href={hrefDeOrden(orden, columna)} data-activo={sentido !== "none" || undefined}>
                      {titulo}
                      <span aria-hidden="true" className="naves-orden-flecha">
                        {sentido === "ascending" ? "▲" : sentido === "descending" ? "▼" : "↕"}
                      </span>
                    </Link>
                  </th>
                );
              })}
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((vehicle) => {
              const peor = peorVencimiento(vehicle, hoy);
              const papeles = vencimientosOrdenados(vehicle, hoy);
              const pendientes = papeles.filter((papel) => papel.level === "vencido" || papel.level === "proximo").length;
              return (
                <tr key={vehicle.id} data-nivel={peor?.level ?? undefined}>
                  <td data-label="Unidad">
                    {vehicle.internalNumber ? (
                      <>
                        <strong>Interno {vehicle.internalNumber}</strong>
                        <br />
                        <span className="muted">{vehicle.name}</span>
                      </>
                    ) : (
                      vehicle.name
                    )}
                    <br />
                    <span className="muted">{TIPO_LABEL[vehicle.kind] ?? vehicle.kind}</span>
                  </td>
                  <td data-label="Marca / modelo · patente">
                    {vehicle.brand} · {vehicle.model}
                    <br />
                    <span className="muted">{vehicle.licensePlate ?? "sin patente"}</span>
                  </td>
                  <td data-label="Año">{vehicle.year ?? "—"}</td>
                  <td data-label="Titular">{vehicle.owner ?? "—"}</td>
                  <td data-label="Seguro">
                    {vehicle.insurer ?? "—"}
                    {vehicle.publicTransport ? (
                      <>
                        <br />
                        <span className="pill pill-estado" data-tono="ok">
                          transporte público
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td data-label="Vencimientos">
                    <div className="fleet-docs">
                      <VencimientosDialog
                        unidad={vehicle.internalNumber ? `Interno ${vehicle.internalNumber}` : vehicle.name}
                        detalle={`${vehicle.licensePlate ?? "sin patente"} · ${vehicle.brand} ${vehicle.model}`}
                        filas={papeles.map((papel) => ({
                          tipo: papel.tipo,
                          fecha: formatoFecha(papel.fecha),
                          estado: complianceLabel(papel.fecha, hoy),
                          level: papel.level
                        }))}
                        pendientes={pendientes}
                        nivel={peor?.level ?? null}
                        editarHref={`/admin/naves/${vehicle.id}`}
                      />
                      {peor ? (
                        <small className="fleet-docs-peor" data-nivel={peor.level ?? "ok"}>
                          {peor.tipo}: {complianceLabel(peor.fecha, hoy)}
                        </small>
                      ) : (
                        <small className="muted">Sin fechas cargadas</small>
                      )}
                    </div>
                  </td>
                  <td data-label="Capacidad">{vehicle._count.seats} pasajeros</td>
                  <td data-label="Estado">
                    <span className={`status-pill ${vehicle.isActive ? "active" : "inactive"}`}>
                      {vehicle.isActive ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td data-label="Acciones">
                    {/* Inactivar y borrar viven en la ficha de la nave, no en el listado: son
                        cambios de fondo y conviene hacerlos mirando la unidad. */}
                    <div className="table-actions">
                      <Link className="ghost-button" href={`/admin/naves/${vehicle.id}`}>Editar</Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pagina.totalPages > 1 ? (
        <nav className="pagination" aria-label="Paginación de naves">
          {pagina.page > 1 ? (
            <Link className="pagination-link" href={hrefDePagina(orden, pagina.page - 1)} rel="prev">← Anterior</Link>
          ) : (
            <span aria-disabled="true" className="pagination-link">← Anterior</span>
          )}
          <span className="pagination-status">
            Mostrando {pagina.desde}–{pagina.hasta} de {pagina.total} · página {pagina.page} de {pagina.totalPages}
          </span>
          {pagina.page < pagina.totalPages ? (
            <Link className="pagination-link" href={hrefDePagina(orden, pagina.page + 1)} rel="next">Siguiente →</Link>
          ) : (
            <span aria-disabled="true" className="pagination-link">Siguiente →</span>
          )}
        </nav>
      ) : null}
      <p className="muted flights-note">
        {VEHICLE_TEMPLATES.length} plantillas de asientos disponibles. El titular, la técnica, el RTO y la póliza se
        cargan desde la ficha de cada unidad.
      </p>
    </AdminShell>
  );
}
