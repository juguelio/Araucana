import { AdminShell } from "@/components/admin-shell";
import { totalsByCurrency } from "@/lib/accounting/export-rows";
import { createMonthPeriod, createRangePeriod, getAccountingReport } from "@/lib/accounting/service";
import { formatCurrency } from "@/lib/admin/salary";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";

type ReportsPageProps = {
  searchParams?: Promise<{
    month?: string;
    from?: string;
    to?: string;
    vehicleId?: string;
    notice?: string;
  }>;
};

type ReportGroupProps = {
  title: string;
  empty: string;
  groups: Array<{
    id: string;
    label: string;
    amountCents: number;
    currency: string;
  }>;
};

function ReportGroup({ title, empty, groups }: ReportGroupProps) {
  return (
    <section className="plain-card report-panel">
      <h2>{title}</h2>
      <div className="report-list">
        {groups.map((group) => (
          <div className="report-row" key={group.id}>
            <span>{group.label}</span>
            <strong>{formatCurrency(group.amountCents, group.currency)}</strong>
          </div>
        ))}
        {groups.length === 0 ? <p className="muted">{empty}</p> : null}
      </div>
    </section>
  );
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  await getCurrentAdminOrRedirect();
  const params = await searchParams;
  const period = params?.from && params?.to ? createRangePeriod(params.from, params.to) : createMonthPeriod(params?.month);
  const vehicles = await prisma.vehicle.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true
    }
  });
  const report = await getAccountingReport({
    period,
    vehicleId: params?.vehicleId || undefined
  });

  const exportParams = new URLSearchParams();
  if (params?.month) exportParams.set("month", params.month);
  if (params?.from) exportParams.set("from", params.from);
  if (params?.to) exportParams.set("to", params.to);
  if (params?.vehicleId) exportParams.set("vehicleId", params.vehicleId);
  const exportHref = `/admin/reportes/export${exportParams.size > 0 ? `?${exportParams.toString()}` : ""}`;

  // Los totales no suman monedas distintas: la tarjeta muestra una y el resto va aparte.
  const porMoneda = totalsByCurrency(report);
  const principal =
    porMoneda.find((fila) => fila.currency === "ARS") ??
    porMoneda[0] ?? { currency: "ARS", incomeCents: report.totals.incomeCents, expenseCents: report.totals.expenseCents, count: 0 };
  const otrasMonedas = porMoneda.filter((fila) => fila.currency !== principal.currency);
  const monedas = porMoneda.map((fila) => fila.currency);

  return (
    <AdminShell title="Reportes" eyebrow={period.label} notice={params?.notice}>
      <form className="filter-bar" action="/admin/reportes">
        <label>
          Mes
          <input name="month" type="month" defaultValue={params?.month ?? (!params?.from ? new Date().toISOString().slice(0, 7) : "")} />
        </label>
        <label>
          Desde
          <input name="from" type="date" defaultValue={params?.from ?? ""} />
        </label>
        <label>
          Hasta
          <input name="to" type="date" defaultValue={params?.to ?? ""} />
        </label>
        <label>
          Nave
          <select name="vehicleId" defaultValue={params?.vehicleId ?? ""}>
            <option value="">Todas</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.name}
              </option>
            ))}
          </select>
        </label>
        <button className="ghost-button" type="submit">Filtrar</button>
        <a className="ghost-button report-export" href={exportHref} download>
          Descargar Excel
        </a>
      </form>

      <section className="admin-grid">
        <div className="admin-card">
          <span className="muted">Ingresos{otrasMonedas.length > 0 ? ` (${principal.currency})` : ""}</span>
          <strong>{formatCurrency(principal.incomeCents, principal.currency)}</strong>
          {otrasMonedas.map((fila) => (
            <small className="currency-line" key={fila.currency}>
              {fila.currency}: {formatCurrency(fila.incomeCents, fila.currency)}
            </small>
          ))}
        </div>
        <div className="admin-card">
          <span className="muted">Egresos{otrasMonedas.length > 0 ? ` (${principal.currency})` : ""}</span>
          <strong>{formatCurrency(principal.expenseCents, principal.currency)}</strong>
          {otrasMonedas.map((fila) => (
            <small className="currency-line" key={fila.currency}>
              {fila.currency}: {formatCurrency(fila.expenseCents, fila.currency)}
            </small>
          ))}
        </div>
        <div className="admin-card">
          <span className="muted">Saldo{otrasMonedas.length > 0 ? ` (${principal.currency})` : ""}</span>
          <strong>{formatCurrency(principal.incomeCents - principal.expenseCents, principal.currency)}</strong>
          {otrasMonedas.map((fila) => (
            <small className="currency-line" key={fila.currency}>
              {fila.currency}: {formatCurrency(fila.incomeCents - fila.expenseCents, fila.currency)}
            </small>
          ))}
        </div>
      </section>

      <p className="muted report-note">
        Los ingresos son reservas confirmadas o con pago aprobado, por el total de la reserva (no por el monto del pago): no
        representan caja cobrada.
        {monedas.length > 1
          ? ` El período tiene ${monedas.length} monedas (${monedas.join(", ")}): arriba y en el Excel van separadas, nunca sumadas.`
          : ""}
      </p>

      <section className="report-grid">
        <ReportGroup title="Ingresos por nave" empty="Sin ingresos para el periodo." groups={report.incomeByVehicle} />
        <ReportGroup title="Gastos por nave" empty="Sin gastos asociados a naves." groups={report.expensesByVehicle} />
        <ReportGroup title="Gastos por categoria" empty="Sin egresos cargados." groups={report.expensesByCategory} />
        <ReportGroup title="Sueldos por persona" empty="Sin sueldos pagados." groups={report.salariesByPerson} />
      </section>
    </AdminShell>
  );
}
