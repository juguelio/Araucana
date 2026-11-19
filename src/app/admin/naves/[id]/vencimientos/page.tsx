import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { formatCurrency } from "@/lib/admin/salary";
import { DIAS_ALERTA, complianceLabel, formatoFecha, vencimientosDe } from "@/lib/vehicles/compliance";
import { historialDePapeles, valorDePapel } from "@/lib/vehicles/ficha";
import { CabeceraDeNave, SinDatos, cargarNave, diaUtc, fechaHora, hrefDeNave, nombreDeNave } from "../ficha-de-nave";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ notice?: string }>;
};

/** Papeles de la nave: técnica, RTO y póliza, el seguro, su historial y los pagos de seguro. */
export default async function VencimientosDeNavePage({ params, searchParams }: Props) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const { id } = await params;
  const notice = (await searchParams)?.notice;
  const hoy = new Date();
  const nave = await cargarNave(id);

  const [auditoria, pagosDeSeguro] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entity: "VEHICLE", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { id: true, createdAt: true, actorName: true, actorEmail: true, changes: true }
    }),
    prisma.accountingEntry.findMany({ where: { vehicleId: id, category: "INSURANCE" }, orderBy: { occurredAt: "desc" } })
  ]);
  const papeles = vencimientosDe(nave, hoy);
  const historial = historialDePapeles(auditoria);
  const totalSeguro = pagosDeSeguro.filter((p) => p.currency === "ARS").reduce((t, p) => t + p.amountCents, 0);

  return (
    <AdminShell role={sessionUser.role} title={nombreDeNave(nave)} eyebrow="Naves · Vencimientos" notice={notice}>
      <CabeceraDeNave nave={nave} seccion="vencimientos" hoy={hoy} />

      <section className="nave-panel" aria-label="Vencimientos">
        {papeles.map((p) => (
          <div key={p.tipo} className="admin-card nave-opcion" data-nivel={p.level ?? undefined}>
            <span className="nave-opcion-titulo">{p.tipo === "Técnica" ? "Revisión técnica (VTV)" : p.tipo === "RTO" ? "RTO nacional" : "Póliza de seguro"}</span>
            <strong>{formatoFecha(p.fecha)}</strong>
            <span className="nave-papel" data-nivel={p.level ?? undefined}>{complianceLabel(p.fecha, hoy)}</span>
          </div>
        ))}
        <div className="admin-card nave-opcion">
          <span className="nave-opcion-titulo">Seguro</span>
          <strong>{nave.insurer ?? "Sin aseguradora"}</strong>
          <span className="muted">{nave.publicTransport ? "Habilitada para transporte público" : "No habilitada para transporte público"}</span>
        </div>
      </section>
      <p className="muted nave-nota">
        Se avisa {DIAS_ALERTA} días antes de cada vencimiento. Las fechas y la aseguradora se cambian desde{" "}
        <Link href={hrefDeNave(id, "editar")}>Editar</Link>.
      </p>

      <section className="plain-card admin-section" aria-labelledby="papeles-historial">
        <h2 id="papeles-historial">Historial de cambios</h2>
        {historial.length === 0 ? (
          <SinDatos titulo="Sin cambios registrados.">
            Cada vez que se carga o renueva una fecha, o se cambia la aseguradora, queda anotado acá con quién lo hizo.
          </SinDatos>
        ) : (
          <div className="table-scroll">
            <table className="data-table nave-tabla">
              <thead>
                <tr>
                  <th>Cuándo</th>
                  <th>Qué</th>
                  <th>Antes</th>
                  <th>Después</th>
                  <th>Quién</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((c) => (
                  <tr key={c.key}>
                    <td data-label="Cuándo">{fechaHora(c.fecha)}</td>
                    <td data-label="Qué">{c.titulo}</td>
                    <td data-label="Antes" className="muted">{valorDePapel(c.campo, c.antes)}</td>
                    <td data-label="Después"><strong>{valorDePapel(c.campo, c.despues)}</strong></td>
                    <td data-label="Quién">{c.quien ?? "Sistema"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="plain-card admin-section" aria-labelledby="papeles-pagos">
        <div className="nave-seccion-top">
          <h2 id="papeles-pagos">Pagos de seguro</h2>
          <span className="muted">Total: {formatCurrency(totalSeguro)}</span>
        </div>
        {pagosDeSeguro.length === 0 ? (
          <SinDatos titulo="No hay pagos de seguro cargados para esta nave.">
            Se cargan en <Link href="/admin/contabilidad">Contabilidad</Link> como egreso «Seguro» eligiendo esta nave.
          </SinDatos>
        ) : (
          <div className="table-scroll">
            <table className="data-table nave-tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Monto</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {pagosDeSeguro.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Fecha">{diaUtc(p.occurredAt)}</td>
                    <td data-label="Monto">{formatCurrency(p.amountCents, p.currency)}</td>
                    <td data-label="Nota">{p.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
