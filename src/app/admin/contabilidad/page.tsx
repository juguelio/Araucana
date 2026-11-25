import { AdminShell } from "@/components/admin-shell";
import { ACCOUNTING_CATEGORY_LABELS } from "@/lib/accounting/types";
import { createMonthPeriod, getAccountingReport } from "@/lib/accounting/service";
import { formatCurrency } from "@/lib/admin/salary";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { argentinaDayStart } from "@/lib/booking/admin-filters";
import { prisma } from "@/lib/db/prisma";
import { terminalDe } from "@/lib/public-service/board";
import { resumenPorChofer } from "@/lib/public-service/workdays";
import { createExpenseAction, createSalaryPaymentAction } from "./actions";
import { AccountingDisclosure } from "./accounting-disclosure";
import { DiasTrabajados } from "./dias-trabajados";
import { ExpenseForm } from "./expense-form";
import { SalaryPaymentForm } from "./salary-payment-form";
import { EncabezadoOrdenable, OrdenOculto } from "@/components/admin-list/encabezado-ordenable";
import { Paginador } from "@/components/admin-list/paginador";
import { hrefDePagina, leerOrden, leerPagina, ordenarEnMemoria, paginar, type OrdenDeListado } from "@/lib/admin/list-order";
import "./contabilidad.css";

type AccountingPageProps = {
  searchParams?: Promise<{
    month?: string;
    notice?: string;
    orden?: string;
    dir?: string;
    page?: string;
  }>;
};

const BASE = "/admin/contabilidad";
const POR_PAGINA = 25;
/** Columnas ordenables de los egresos (issue #192). Por defecto, el más reciente arriba. */
const COLUMNAS = ["fecha", "categoria", "monto", "nave", "persona", "nota"] as const;
type Columna = (typeof COLUMNAS)[number];
const POR_DEFECTO: OrdenDeListado<Columna> = { columna: "fecha", direccion: "desc" };
const mesFormatter = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

function categoriaLabel(category: string) {
  return ACCOUNTING_CATEGORY_LABELS[category as keyof typeof ACCOUNTING_CATEGORY_LABELS] ?? category;
}

function formatDate(date: Date) {
  return date.toLocaleDateString("es-AR", { timeZone: "UTC" });
}

export default async function AccountingPage({ searchParams }: AccountingPageProps) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const params = await searchParams;
  const period = createMonthPeriod(params?.month);
  // El filtro de Contabilidad es un mes UTC; para los días trabajados usamos el día argentino,
  // igual que Servicio público, así una salida de las 22:30 cuenta en el día que salió.
  const mesInicio = period.from.toISOString().slice(0, 10);
  const mesSiguiente = period.to.toISOString().slice(0, 10);
  const [report, vehicles, salaryUsers, mesRows] = await Promise.all([
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
    }),
    prisma.schedule.findMany({
      where: {
        departureAt: { gte: argentinaDayStart(mesInicio), lt: argentinaDayStart(mesSiguiente) },
        driverId: { not: null },
        status: { not: "CANCELLED" },
        route: { is: { bookingMode: "SEATED", isActive: true } }
      },
      select: {
        departureAt: true,
        arrivalAt: true,
        driver: { select: { id: true, name: true, email: true } },
        route: { select: { from: true } }
      }
    })
  ]);
  const resumenMes = resumenPorChofer(
    mesRows
      .filter((row) => terminalDe(row.route.from))
      .map((row) => ({
        driverId: row.driver?.id ?? null,
        driverName: row.driver ? row.driver.name?.trim() || row.driver.email : null,
        departureAt: new Date(row.departureAt),
        arrivalAt: new Date(row.arrivalAt)
      }))
  );
  const mesLabel = mesFormatter.format(period.from);

  // Los egresos del mes ya vienen enteros (el informe los suma): se ordenan y paginan en memoria.
  const filtros = params ?? {};
  const orden = leerOrden(COLUMNAS, POR_DEFECTO, filtros);
  const egresos = ordenarEnMemoria(report.expenses, orden, {
    fecha: (entry) => entry.occurredAt,
    categoria: (entry) => categoriaLabel(entry.category),
    // Montos de monedas distintas no se comparan: primero la moneda, después el importe.
    monto: (entry) => `${entry.currency} ${String(entry.amountCents).padStart(15, "0")}`,
    nave: (entry) => entry.vehicle?.name,
    persona: (entry) => entry.user?.name ?? entry.user?.email,
    nota: (entry) => entry.notes
  });
  const pagina = paginar(egresos, leerPagina(filtros.page), POR_PAGINA);
  const encabezado = (etiqueta: string, columna: Columna) => (
    <EncabezadoOrdenable etiqueta={etiqueta} columna={columna} orden={orden} base={BASE} params={filtros} />
  );

  return (
    <AdminShell role={sessionUser.role} title="Contabilidad" eyebrow={period.label} notice={params?.notice}>
      <form className="filter-bar" action="/admin/contabilidad">
        <OrdenOculto orden={orden} />
        <label>
          Mes
          <input name="month" type="month" defaultValue={params?.month ?? new Date().toISOString().slice(0, 7)} />
        </label>
        <button className="ghost-button" type="submit">Filtrar</button>
      </form>

      <DiasTrabajados mesLabel={mesLabel} resumen={resumenMes} />

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
              {encabezado("Fecha", "fecha")}
              {encabezado("Categoria", "categoria")}
              {encabezado("Monto", "monto")}
              {encabezado("Nave", "nave")}
              {encabezado("Persona", "persona")}
              {encabezado("Nota", "nota")}
            </tr>
          </thead>
          <tbody>
            {pagina.items.map((entry) => (
              <tr key={entry.id}>
                <td>{formatDate(entry.occurredAt)}</td>
                <td>{categoriaLabel(entry.category)}</td>
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
        <Paginador {...pagina} hrefPagina={(n) => hrefDePagina(BASE, filtros, n)} etiqueta="egresos" />
      </section>
    </AdminShell>
  );
}
