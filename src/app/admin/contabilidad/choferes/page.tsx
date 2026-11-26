import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { createMonthPeriod } from "@/lib/accounting/period";
import { ETIQUETA_ESTADO_SUELDO, estadoDeSueldo, fechaPorDefecto } from "@/lib/accounting/sueldos";
import { formatExpiryDay, todayInArgentina } from "@/lib/admin/driver-documents";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { createSalaryPaymentAction } from "../actions";
import { PagoDeSueldo } from "../modales";
import "../contabilidad.css";

const base = "/admin/contabilidad/choferes";
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100);

/** Ficha de sueldo de un chofer: lo vigente en su ficha, los pagos del período y lo que falta. */
export default async function ControlChoferes({ searchParams }: {
  searchParams: Promise<{ month?: string; chofer?: string }>;
}) {
  const actor = await getCurrentAdminOrRedirect();
  const query = await searchParams;
  const today = todayInArgentina();
  const month = typeof query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) ? query.month : today.slice(0, 7);
  const period = createMonthPeriod(month);
  const drivers = await prisma.user.findMany({
    where: { role: "DRIVER" },
    orderBy: [{ isActive: "desc" }, { name: "asc" }, { email: "asc" }],
    select: { id: true, name: true, email: true, role: true, isActive: true, monthlySalaryCents: true, salaryCurrency: true }
  });
  const driver = typeof query.chofer === "string" ? drivers.find((item) => item.id === query.chofer) : drivers[0];
  if (query.chofer && !driver) notFound();
  const payments = driver ? await prisma.accountingEntry.findMany({
    where: { userId: driver.id, salaryPeriod: month, category: { in: ["DRIVER_SALARY", "SECRETARY_SALARY"] } },
    select: { id: true, occurredAt: true, currency: true, amountCents: true, notes: true },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }]
  }) : [];
  const paid = driver ? payments.filter((pago) => pago.currency === driver.salaryCurrency).reduce((sum, pago) => sum + pago.amountCents, 0) : 0;
  const salary = driver?.monthlySalaryCents ?? null;
  const saldo = salary === null ? null : salary - paid;

  return (
    <AdminShell role={actor.role} eyebrow="Contabilidad" title="Sueldos de choferes" action={
      <Link className="ghost-button" href={`/admin/contabilidad?month=${month}#sueldos`}>Volver a sueldos</Link>}>
      {driver ? (
        <>
          <form action={base} className="plain-card admin-form-grid">
            <label>Chofer
              <select name="chofer" defaultValue={driver.id}>
                {drivers.map((item) => (
                  <option key={item.id} value={item.id}>{item.name || item.email}{item.isActive ? "" : " · inactivo"}</option>
                ))}
              </select>
            </label>
            <label>Mes<input required type="month" name="month" defaultValue={month} /></label>
            <button className="button" type="submit">Consultar sueldo</button>
          </form>
          <section className="plain-card admin-section">
            <h2>Sueldo de {period.label.toLowerCase()}</h2>
            <p>{ETIQUETA_ESTADO_SUELDO[estadoDeSueldo(salary, paid)]} · Pagado {money(paid, driver.salaryCurrency)}</p>
            {salary !== null ? (
              <p>
                Sueldo vigente en ficha {money(salary, driver.salaryCurrency)} · {paid > salary ? "Excedente" : "Saldo pendiente"}{" "}
                {money(Math.abs(salary - paid), driver.salaryCurrency)}
              </p>
            ) : <p className="muted">La ficha no tiene sueldo mensual cargado.</p>}
            {payments.length ? (
              <ul>
                {payments.map((pago) => (
                  <li key={pago.id}>{formatExpiryDay(pago.occurredAt)} · {money(pago.amountCents, pago.currency)}{pago.notes ? ` · ${pago.notes}` : ""}</li>
                ))}
              </ul>
            ) : <p>Sin pagos registrados para este período.</p>}
            {driver.isActive && driver.salaryCurrency === "ARS" && (salary === null || paid < salary) ? (
              <PagoDeSueldo
                action={createSalaryPaymentAction}
                users={[{ id: driver.id, name: driver.name, email: driver.email, role: driver.role, monthlySalaryCents: driver.monthlySalaryCents }]}
                userId={driver.id}
                mes={month}
                fecha={fechaPorDefecto(month, today)}
                montoCents={saldo !== null && saldo > 0 ? saldo : null}
                nombre={driver.name || driver.email}
                trigger="Registrar pago en ARS"
                triggerClassName="button"
              />
            ) : null}
          </section>
        </>
      ) : (
        <section className="plain-card admin-section">
          <h2>Todavía no hay choferes cargados</h2>
          <Link href="/admin/choferes">Gestionar choferes</Link>
        </section>
      )}
    </AdminShell>
  );
}
