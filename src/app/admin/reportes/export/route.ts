import { buildAccountingWorkbook } from "@/lib/accounting/export";
import { exportFileName } from "@/lib/accounting/export-rows";
import { createMonthPeriod, createRangePeriod, getAccountingReport } from "@/lib/accounting/service";
import { AuthorizationError, requireAdminUser } from "@/lib/auth/service";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Descarga del reporte contable con los mismos filtros de la pantalla. Sólo ADMIN. */
export async function GET(request: Request) {
  try {
    await requireAdminUser(request);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new Response("No autorizado", { status: 401 });
    }

    throw error;
  }

  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? undefined;
  const from = params.get("from") ?? undefined;
  const to = params.get("to") ?? undefined;
  const vehicleId = params.get("vehicleId") || undefined;

  const period = from && to ? createRangePeriod(from, to) : createMonthPeriod(month);
  const vehicle = vehicleId
    ? await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { name: true } })
    : null;
  const report = await getAccountingReport({ period, vehicleId });

  const meta = {
    periodLabel: period.label,
    from: period.from,
    to: period.to,
    vehicleName: vehicle?.name ?? null,
    generatedAt: new Date()
  };

  const workbook = await buildAccountingWorkbook(report, meta);

  return new Response(new Uint8Array(workbook), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${exportFileName(meta)}"`,
      "Content-Length": String(workbook.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
