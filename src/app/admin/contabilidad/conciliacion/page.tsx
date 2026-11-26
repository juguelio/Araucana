import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { createMonthPeriod } from "@/lib/accounting/period";
import { BankCheck } from "./bank-check";

export default async function Conciliacion({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await getCurrentAdminOrRedirect();
  const period = createMonthPeriod((await searchParams).month);
  const month = period.from.toISOString().slice(0, 7);
  const payments = await prisma.payment.findMany({
    where: { status: "APPROVED", updatedAt: { gte: period.from, lt: period.to } },
    select: {
      provider: true,
      method: true,
      externalRef: true,
      currency: true,
      amountCents: true,
      updatedAt: true,
      reservation: { select: { code: true } },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
  });
  return (
    <AdminShell
      role={user.role}
      title="Cotejo bancario"
      eyebrow="Contabilidad"
      action={
        <Link className="ghost-button" href={"/admin/contabilidad?month=" + month}>
          Volver al mes
        </Link>
      }
    >
      <section className="plain-card admin-section">
        <h2>{period.label}</h2>
        <p>
          Compará los créditos de tu extracto con los {payments.length} pagos aprobados cuya última
          actualización corresponde a este mes. Incluí en el extracto las cuentas que quieras revisar.
        </p>
        <BankCheck
          key={month}
          month={month}
          payments={payments.map((p) => ({
            provider: p.provider,
            method: p.method,
            code: p.reservation.code,
            reference: p.externalRef ?? "",
            date: p.updatedAt.toISOString().slice(0, 10),
            currency: p.currency,
            cents: p.amountCents,
          }))}
        />
      </section>
    </AdminShell>
  );
}
