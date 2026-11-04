import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { VEHICLE_TEMPLATES } from "@/lib/vehicles/templates";
import { complianceLabel, formatoFecha, peorVencimiento, resumenVencimientos, vencimientosDe } from "@/lib/vehicles/compliance";
import { deleteVehicleAction, setVehicleActiveAction } from "./actions";

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

  // Los papeles que hay que mover ya: vencidos o que vencen dentro del umbral.
  const urgentes = vehicles
    .flatMap((vehicle) =>
      vencimientosDe(vehicle, hoy)
        .filter((vencimiento) => vencimiento.level === "vencido" || vencimiento.level === "proximo")
        .map((vencimiento) => ({ vehicle, ...vencimiento }))
    )
    .sort((a, b) => (a.dias ?? 0) - (b.dias ?? 0));

  return (
    <AdminShell
      title="Naves"
      notice={params?.notice}
      action={<Link className="button" href="/admin/naves/nueva">Agregar nave</Link>}
    >
      <section className="admin-grid">
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
        <div className="admin-card">
          <span className="muted">Papeles vencidos / por vencer</span>
          <strong>
            {resumen.vencidos} / {resumen.proximos}
          </strong>
        </div>
      </section>

      {urgentes.length > 0 ? (
        <section className="plain-card admin-section">
          <h2 className="flights-group-title">
            Vencimientos de la flota <span className="muted">{urgentes.length}</span>
          </h2>
          <p className="muted flights-note">
            Revisión técnica, RTO y póliza: lo que venció o vence dentro de los próximos 90 días. No bloquea la venta;
            es para mover el trámite antes de que la unidad quede parada.
          </p>
          <div className="fleet-due-list">
            {urgentes.map(({ vehicle, tipo, fecha, level, dias }) => (
              <article className="fleet-due" data-nivel={level} key={`${vehicle.id}-${tipo}`}>
                <span className="fleet-due-date">{formatoFecha(fecha)}</span>
                <span className="fleet-due-unit">
                  <strong>{vehicle.internalNumber ? `Interno ${vehicle.internalNumber}` : vehicle.name}</strong>
                  <small className="muted">
                    {vehicle.licensePlate ?? "sin patente"} · {vehicle.brand} {vehicle.model} · {tipo} ·{" "}
                    {vehicle.owner ?? "sin titular"}
                  </small>
                </span>
                <span className="fleet-due-pill" data-nivel={level}>
                  {complianceLabel(fecha, hoy)}
                </span>
                <Link className="ghost-button" href={`/admin/naves/${vehicle.id}`}>
                  Editar
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <table className="data-table">
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
            return (
              <tr key={vehicle.id}>
                <td>
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
                <td>
                  {vehicle.brand} · {vehicle.model}
                  <br />
                  <span className="muted">{vehicle.licensePlate ?? "sin patente"}</span>
                </td>
                <td>{vehicle.owner ?? "—"}</td>
                <td>
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
                <td>
                  <span className="muted">
                    Téc. {formatoFecha(vehicle.technicalInspectionDueAt)} · RTO {formatoFecha(vehicle.rtoDueAt)} · Pól.{" "}
                    {formatoFecha(vehicle.policyDueAt)}
                  </span>
                  {peor ? (
                    <>
                      <br />
                      <span
                        className="pill pill-estado"
                        data-tono={peor.level === "vencido" ? "grave" : peor.level === "proximo" ? "atencion" : "ok"}
                      >
                        {peor.tipo}: {complianceLabel(peor.fecha, hoy)}
                      </span>
                    </>
                  ) : null}
                </td>
                <td>{vehicle._count.seats} pasajeros</td>
                <td>
                  <span className={`status-pill ${vehicle.isActive ? "active" : "inactive"}`}>
                    {vehicle.isActive ? "Activa" : "Inactiva"}
                  </span>
                </td>
                <td>
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
      <p className="muted flights-note">
        {VEHICLE_TEMPLATES.length} plantillas de asientos disponibles. El titular, la técnica, el RTO y la póliza se
        cargan desde la ficha de cada unidad.
      </p>
    </AdminShell>
  );
}
