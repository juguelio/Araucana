import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { VEHICLE_TEMPLATES } from "@/lib/vehicles/templates";
import { complianceLabel, formatoFecha, peorVencimiento, resumenVencimientos, vencimientosOrdenados } from "@/lib/vehicles/compliance";
import { deleteVehicleAction, setVehicleActiveAction } from "./actions";
import { VencimientosDialog } from "./vencimientos-dialog";
import "./naves.css";

type AdminVehiclesPageProps = {
  searchParams?: Promise<{
    notice?: string;
  }>;
};

const TIPO_LABEL: Record<string, string> = { CAMIONETA: "Camioneta", BUS: "Bus", UTILITARIO: "Utilitario" };

export default async function AdminVehiclesPage({ searchParams }: AdminVehiclesPageProps) {
  await getCurrentAdminOrRedirect();
  const params = await searchParams;
  const hoy = new Date();
  const vehicles = await prisma.vehicle.findMany({
    orderBy: [{ isActive: "desc" }, { internalNumber: "asc" }, { name: "asc" }],
    include: {
      _count: {
        select: {
          seats: true,
          schedules: true
        }
      }
    }
  });
  const activeVehicles = vehicles.filter((vehicle) => vehicle.isActive);
  const publicos = vehicles.filter((vehicle) => vehicle.publicTransport);
  const totalSeats = vehicles.reduce((total, vehicle) => total + vehicle._count.seats, 0);
  const resumen = resumenVencimientos(vehicles, hoy);
  // Las unidades con algún papel vencido o por vencer, de la más urgente a la menos (mismos datos
  // que la columna «Vencimientos»; acá juntos para no recorrer la tabla buscándolos).
  const urgentes = vehicles
    .map((vehicle) => {
      const papeles = vencimientosOrdenados(vehicle, hoy).filter((p) => p.level === "vencido" || p.level === "proximo");
      return { vehicle, papeles, peor: papeles[0] ?? null };
    })
    .filter((u): u is typeof u & { peor: NonNullable<typeof u.peor> } => u.peor !== null)
    .sort((a, b) => (a.peor.level === b.peor.level ? (a.peor.dias ?? 0) - (b.peor.dias ?? 0) : a.peor.level === "vencido" ? -1 : 1));
  const nombreUnidad = (vehicle: (typeof vehicles)[number]) => (vehicle.internalNumber ? `Interno ${vehicle.internalNumber}` : vehicle.name);

  return (
    <AdminShell
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
        <a className="admin-card naves-stat-link" href="#vencimientos" data-alerta={resumen.vencidos > 0 || undefined}>
          <span className="muted">Papeles vencidos / por vencer</span>
          <strong>
            {resumen.vencidos} / {resumen.proximos}
          </strong>
        </a>
      </section>

      {urgentes.length > 0 ? (
        <section className="plain-card admin-section naves-vencimientos" id="vencimientos">
          <h2>Vencimientos de la flota</h2>
          <p className="muted">Unidades con algún papel vencido o que vence en los próximos días, de la más urgente a la menos.</p>
          <ul className="naves-urgentes">
            {urgentes.map(({ vehicle, papeles, peor }) => (
              <li key={vehicle.id} data-nivel={peor.level}>
                <Link href={`/admin/naves/${vehicle.id}`} className="naves-urgente-unidad">
                  <strong>{nombreUnidad(vehicle)}</strong>
                  <span className="muted">{vehicle.licensePlate ?? "sin patente"} · {vehicle.brand} {vehicle.model}</span>
                </Link>
                <span className="naves-urgente-papeles">
                  {papeles.map((papel) => (
                    <span key={papel.tipo} className="pill pill-estado" data-tono={papel.level === "vencido" ? "grave" : "atencion"}>
                      {papel.tipo}: {complianceLabel(papel.fecha, hoy)}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="table-scroll naves-tabla-scroll">
        <table className="data-table naves-tabla">
          <thead>
            <tr>
              <th>Unidad</th>
              <th>Marca / modelo · patente</th>
              <th>Titular</th>
              <th>Seguro</th>
              <th>Vencimientos</th>
              <th>Capacidad</th>
              <th>Estado</th>
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
                    <div className="table-actions">
                      <Link className="ghost-button" href={`/admin/naves/${vehicle.id}`}>Editar</Link>
                      <form action={setVehicleActiveAction}>
                        <input type="hidden" name="id" value={vehicle.id} />
                        <input type="hidden" name="isActive" value={vehicle.isActive ? "false" : "true"} />
                        <button className="ghost-button" type="submit">
                          {vehicle.isActive ? "Inactivar" : "Activar"}
                        </button>
                      </form>
                      <form action={deleteVehicleAction}>
                        <input type="hidden" name="id" value={vehicle.id} />
                        <button className="danger-button" type="submit">
                          {vehicle._count.schedules > 0 ? "Archivar" : "Borrar"}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted flights-note">
        {VEHICLE_TEMPLATES.length} plantillas de asientos disponibles. El titular, la técnica, el RTO y la póliza se
        cargan desde la ficha de cada unidad.
      </p>
    </AdminShell>
  );
}
