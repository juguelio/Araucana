import { AuthorizationError, requireReservationsUser } from "@/lib/auth/service";
import { getExcursionBookingsForDay } from "@/lib/excursions/booking-repository";
import { buildExcursionSheetBlocks, buildExcursionSheetWorkbook, excursionSheetFileName } from "@/lib/excursions/sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Planilla de excursiones en Excel (issue #110), con el mismo formato que la del chofer.
 *
 * - `?date=YYYY-MM-DD` — todas las salidas del día.
 * - `?date=…&excursion=<id>` — sólo una excursión.
 */
export async function GET(request: Request) {
  try {
    await requireReservationsUser(request);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new Response("No autorizado", { status: 401 });
    }
    throw error;
  }

  const params = new URL(request.url).searchParams;
  const date = params.get("date") ?? "";
  const excursionId = params.get("excursion") || null;

  if (!DATE_PATTERN.test(date)) {
    return new Response("Fecha inválida: se espera YYYY-MM-DD", { status: 400 });
  }

  const blocks = buildExcursionSheetBlocks(await getExcursionBookingsForDay(date, excursionId));
  const workbook = await buildExcursionSheetWorkbook({ date, generatedAt: new Date() }, blocks);

  return new Response(new Uint8Array(workbook), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${excursionSheetFileName(date)}"`,
      "Content-Length": String(workbook.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
