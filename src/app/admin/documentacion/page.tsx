import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { complianceOverview, kindLabel } from "@/lib/compliance/documents";
import { prisma } from "@/lib/db/prisma";
import { deleteDocumentAction } from "./actions";

type AdminDocumentationPageProps = {
  searchParams?: Promise<{ notice?: string }>;
};

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function statusBadge(daysLeft: number) {
  if (daysLeft < 0) return <span className="status-dot">● Vencido</span>;
  if (daysLeft <= 7) return <span className="status-dot">● Vence en {daysLeft} días</span>;
  return <span className="muted">Vence en {daysLeft} días</span>;
}

export default async function AdminDocumentationPage({ searchParams }: AdminDocumentationPageProps) {
  await getCurrentAdminOrRedirect();
  const params = await searchParams;
  const overview = await complianceOverview();

  const [vehicles, drivers] = await Promise.all([
    prisma.vehicle.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, licensePlate: true } }),
    prisma.user.findMany({
      where: { role: "DRIVER" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true }
    })
  ]);

  const nombreNave = new Map(vehicles.map((v) => [v.id, `${v.name}${v.licensePlate ? ` (${v.licensePlate})` : ""}`]));
  const nombreChofer = new Map(drivers.map((d) => [d.id, d.name ?? d.email]));

  const vencidosNaves = overview.vehicles.expired;
  const proxiNaves = overview.vehicles.expiring;
  const vencidosChoferes = overview.drivers.expired;
  const proxiChoferes = overview.drivers.expiring;

  const dias = (fecha: Date) => Math.ceil((fecha.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

  const filaNave = (doc: (typeof vencidosNaves)[number], subject: "VEHICLE") => {
    const raw = (overview.raw.vehicleDocs as Array<{ id: string; vehicleId: string }>).find((d) => d.id === doc.id);
    return (
      <tr key={doc.id}>
        <td>{raw ? nombreNave.get(raw.vehicleId) ?? raw.vehicleId : doc.id}</td>
        <td>{kindLabel(subject, doc.kind)}</td>
        <td>{formatDate(doc.expiresAt)}</td>
        <td>{doc.critical ? statusBadge(dias(doc.expiresAt)) : <span className="muted">No crítico</span>}</td>
        <td>
          <form action={deleteDocumentAction}>
            <input type="hidden" name="id" value={doc.id} />
            <input type="hidden" name="subject" value="VEHICLE" />
            <button className="ghost-button" type="submit">Borrar</button>
          </form>
        </td>
      </tr>
    );
  };

  const filaChofer = (doc: (typeof vencidosChoferes)[number], subject: "DRIVER") => {
    const raw = (overview.raw.driverDocs as Array<{ id: string; userId: string }>).find((d) => d.id === doc.id);
    return (
      <tr key={doc.id}>
        <td>{raw ? nombreChofer.get(raw.userId) ?? raw.userId : doc.id}</td>
        <td>{kindLabel(subject, doc.kind)}</td>
        <td>{formatDate(doc.expiresAt)}</td>
        <td>{doc.critical ? statusBadge(dias(doc.expiresAt)) : <span className="muted">No crítico</span>}</td>
        <td>
          <form action={deleteDocumentAction}>
            <input type="hidden" name="id" value={doc.id} />
            <input type="hidden" name="subject" value="DRIVER" />
            <button className="ghost-button" type="submit">Borrar</button>
          </form>
        </td>
      </tr>
    );
  };

  return (
    <AdminShell
      title="Documentación"
      eyebrow="Operación"
      notice={params?.notice}
      action={<Link className="button" href="/admin/documentacion/nueva">Agregar documento</Link>}
    >
      <section className="admin-grid">
        <div className="admin-card">
          <span className="muted">Vencidos</span>
          <strong>{vencidosNaves.length + vencidosChoferes.length}</strong>
        </div>
        <div className="admin-card">
          <span className="muted">Vencen en 30 días</span>
          <strong>{proxiNaves.length + proxiChoferes.length}</strong>
        </div>
        <div className="admin-card">
          <span className="muted">Naves / choferes con papeles</span>
          <strong>{vehicles.length} / {drivers.length}</strong>
        </div>
      </section>

      <p className="muted">
        Si una nave o un chofer tiene un documento crítico vencido, el sistema <strong>no permite</strong> crear la
        salida ni asignarle el vehículo o el chofer.
      </p>

      <h2>Naves</h2>
      <table className="data-table">
        <thead>
          <tr><th>Nave</th><th>Documento</th><th>Vence</th><th>Estado</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          {[...vencidosNaves, ...proxiNaves].map((doc) => filaNave(doc, "VEHICLE"))}
          {vencidosNaves.length + proxiNaves.length === 0 ? (
            <tr><td colSpan={5}>Ninguna nave tiene documentación vencida ni por vencer en 30 días.</td></tr>
          ) : null}
        </tbody>
      </table>

      <h2>Choferes</h2>
      <table className="data-table">
        <thead>
          <tr><th>Chofer</th><th>Documento</th><th>Vence</th><th>Estado</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          {[...vencidosChoferes, ...proxiChoferes].map((doc) => filaChofer(doc, "DRIVER"))}
          {vencidosChoferes.length + proxiChoferes.length === 0 ? (
            <tr><td colSpan={5}>Ningún chofer tiene documentación vencida ni por vencer en 30 días.</td></tr>
          ) : null}
        </tbody>
      </table>
    </AdminShell>
  );
}
