import { AdminShell } from "@/components/admin-shell";
import { ACCOUNTING_CATEGORY_LABELS } from "@/lib/accounting/types";
import { createMonthPeriod, getAccountingReport } from "@/lib/accounting/service";
import { formatCurrency } from "@/lib/admin/salary";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { createExpenseAction, createSalaryPaymentAction } from "./actions";
import { AccountingDisclosure } from "./accounting-disclosure";
import { ExpenseForm } from "./expense-form";
import { SalaryPaymentForm } from "./salary-payment-form";

type AccountingPageProps = {
  searchParams?: Promise<{
    month?: string;
    notice?: string;
  }>;
};

function formatDate(date: Date) {
  return date.toLocaleDateString("es-AR", { timeZone: "UTC" });
}

export default async function AccountingPage({ searchParams }: AccountingPageProps) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const params = await searchParams;
  const period = createMonthPeriod(params?.month);
  const [report, vehicles, salaryUsers] = await Promise.all([
    getAccountingReport({ period }),
    prisma.vehicle.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true
      }
    }),
    prisma.user.findMany({
      where: {
        role: {
          in: ["DRIVER", "SECRETARY"]
        },
        isActive: true
      },
      orderBy: [{ role: "asc" }, { name: "asc" }, { email: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        monthlySalaryCents: true
      }
    })
  ]);

  return (
    <AdminShell role={sessionUser.role} title="Contabilidad" eyebrow={period.label} notice={params?.notice}>
      <form className="filter-bar" action="/admin/contabilidad">
        <label>
          Mes
          <input name="month" type="month" defaultValue={params?.month ?? new Date().toISOString().slice(0, 7)} />
        </label>
        <button className="ghost-button" type="submit">Filtrar</button>
      </form>

      <section className="admin-grid">
        <div className="admin-card">
          <span className="muted">Ingresos automaticos</span>
          <strong>{formatCurrency(report.totals.incomeCents)}</strong>
        </div>
        <div className="admin-card">
          <span className="muted">Egresos cargados</span>
          <strong>{formatCurrency(report.totals.expenseCents)}</strong>
        </div>
        <div className="admin-card">
          <span className="muted">Saldo</span>
          <strong>{formatCurrency(report.totals.balanceCents)}</strong>
        </div>
      </section>

      <section className="admin-split">
        <AccountingDisclosure title="Nuevo egreso" buttonLabel="Agregar egreso">
          <ExpenseForm action={createExpenseAction} vehicles={vehicles} />
        </AccountingDisclosure>
        {salaryUsers.length ? (
          <AccountingDisclosure title="Pago de sueldo" buttonLabel="Registrar pago">
            <SalaryPaymentForm action={createSalaryPaymentAction} users={salaryUsers} />
          </AccountingDisclosure>
        ) : (
          <div className="plain-card admin-section">
            <h2>Pago de sueldo</h2>
            <p className="muted">Carga una secretaria o chofer activo para registrar pagos.</p>
          </div>
        )}
      </section>

      <section className="plain-card admin-section">
        <h2>Egresos recientes</h2>
        <table className="data-table embedded-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Categoria</th>
              <th>Monto</th>
              <th>Nave</th>
              <th>Persona</th>
              <th>Nota</th>
            </tr>
          </thead>
          <tbody>
            {report.expenses.map((entry) => (
              <tr key={entry.id}>
                <td>{formatDate(entry.occurredAt)}</td>
                <td>{ACCOUNTING_CATEGORY_LABELS[entry.category as keyof typeof ACCOUNTING_CATEGORY_LABELS] ?? entry.category}</td>
                <td>{formatCurrency(entry.amountCents, entry.currency)}</td>
                <td>{entry.vehicle?.name ?? "-"}</td>
                <td>{entry.user?.name ?? entry.user?.email ?? "-"}</td>
                <td>{entry.notes ?? "-"}</td>
              </tr>
            ))}
            {report.expenses.length === 0 ? (
              <tr>
                <td colSpan={6}>Todavia no hay egresos cargados para este periodo.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}
