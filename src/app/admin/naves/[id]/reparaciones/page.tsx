import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { formatCurrency } from "@/lib/admin/salary";
import { GRAVEDAD_LABEL, type Gravedad } from "@/lib/vehicles/ficha";
import { CabeceraDeNave, SinDatos, cargarNave, diaUtc, fechaCorta, hrefDeNave, nombreDeNave } from "../ficha-de-nave";
import { createRepairAction } from "../ficha-actions";
import { RepairForm } from "../ficha-forms";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ notice?: string; danio?: string }>;
};

/**
 * Reparaciones de la nave: los egresos «Arreglo» de contabilidad cargados con esta unidad, con el
 * daño que cerró cada uno. Se pueden registrar desde acá (quedan también en Contabilidad).
 */
export default async function ReparacionesDeNavePage({ params, searchParams }: Props) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const nave = await cargarNave(id);
  const [arreglos, abiertos] = await Promise.all([
    prisma.accountingEntry.findMany({
      where: { vehicleId: id, category: "REPAIR" },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      include: { repairedDamages: { select: { id: true, description: true } } }
    }),
    prisma.vehicleDamage.findMany({
      where: { vehicleId: id, status: { not: "REPARADO" } },
      orderBy: { occurredAt: "desc" },
      select: { id: true, description: true, severity: true, occurredAt: true }
    })
  ]);
  const totales = new Map<string, number>();
  for (const a of arreglos) totales.set(a.currency, (totales.get(a.currency) ?? 0) + a.amountCents);
  const anio = new Date().getFullYear();
  const esteAnio = arreglos.filter((a) => a.occurredAt.getUTCFullYear() === anio && a.currency === "ARS").reduce((t, a) => t + a.amountCents, 0);
  const danioElegido = abiertos.some((d) => d.id === query.danio) ? query.danio : undefined;

  return (
    <AdminShell role={sessionUser.role} title={nombreDeNave(nave)} eyebrow="Naves · Reparaciones" notice={query.notice}>
      <CabeceraDeNave nave={nave} seccion="reparaciones" />

      <section className="nave-panel" aria-label="Resumen de reparaciones">
        <div className="admin-card nave-opcion">
          <span className="nave-opcion-titulo">Gastado en arreglos</span>
          <strong>{totales.size ? [...totales].map(([moneda, total]) => formatCurrency(total, moneda)).join(" + ") : formatCurrency(0)}</strong>
          <span className="muted">{arreglos.length} arreglo{arreglos.length === 1 ? "" : "s"} en total</span>
        </div>
        <div className="admin-card nave-opcion">
          <span className="nave-opcion-titulo">En {anio}</span>
          <strong>{formatCurrency(esteAnio)}</strong>
          <span className="muted">desde el 1° de enero</span>
        </div>
        <Link className="admin-card nave-opcion" href={hrefDeNave(id, "danios")} data-nivel={abiertos.length ? "proximo" : undefined}>
          <span className="nave-opcion-titulo">Daños sin reparar</span>
          <strong>{abiertos.length}</strong>
          <span className="nave-opcion-ir">Ver daños →</span>
        </Link>
      </section>

      <section className="plain-card admin-section" aria-labelledby="reparaciones-lista">
        <h2 id="reparaciones-lista">Arreglos</h2>
        {arreglos.length === 0 ? (
          <SinDatos titulo="No hay arreglos cargados para esta nave.">
            Registralo abajo, o en Contabilidad como egreso «Arreglo» eligiendo esta nave.
          </SinDatos>
        ) : (
          <div className="table-scroll">
            <table className="data-table nave-tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Detalle</th>
                  <th>Daño que reparó</th>
                  <th>Monto</th>
                </tr>
              </thead>
              <tbody>
                {arreglos.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Fecha">{diaUtc(a.occurredAt)}</td>
                    <td data-label="Detalle">{a.notes ?? <span className="muted">sin detalle</span>}</td>
                    <td data-label="Daño que reparó">
                      {a.repairedDamages.length ? a.repairedDamages.map((d) => d.description).join(" · ") : <span className="muted">—</span>}
                    </td>
                    <td data-label="Monto"><strong>{formatCurrency(a.amountCents, a.currency)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="plain-card admin-section" aria-labelledby="nuevo-arreglo-titulo" id="nuevo-arreglo">
        <h2 id="nuevo-arreglo-titulo">Registrar un arreglo</h2>
        <p className="muted">Queda como egreso «Arreglo» en Contabilidad con esta nave. Si repara un daño, el daño se cierra.</p>
        <RepairForm
          action={createRepairAction}
          vehicleId={id}
          danioElegido={danioElegido}
          danios={abiertos.map((d) => ({
            id: d.id,
            label: `${fechaCorta(d.occurredAt)} · ${GRAVEDAD_LABEL[d.severity as Gravedad] ?? d.severity} · ${d.description}`
          }))}
        />
      </section>
    </AdminShell>
  );
}
