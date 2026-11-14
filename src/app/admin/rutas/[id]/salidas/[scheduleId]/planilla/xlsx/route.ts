import { AuthorizationError, requireReservationsUser } from "@/lib/auth/service";
import { buildRouteSheet, buildRouteSheetWorkbook, routeSheetFileName } from "@/lib/driver/route-sheet";
import { getRouteSheetInput } from "@/lib/driver/route-sheet-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Planilla del chofer en Excel (issue #136): una salida programada, con las mismas filas que la
 * pantalla — las dos salen del mismo `buildRouteSheet`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; scheduleId: string }> }) {
  try {
    await requireReservationsUser(request);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new Response("No autorizado", { status: 401 });
    }
    throw error;
  }

  const { scheduleId } = await params;
  const input = await getRouteSheetInput(scheduleId);

  if (!input) {
    return new Response("No encontramos la salida", { status: 404 });
  }

  const sheet = buildRouteSheet(input);
  const workbook = await buildRouteSheetWorkbook(sheet, { generatedAt: new Date() });

  return new Response(new Uint8Array(workbook), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${routeSheetFileName(sheet)}"`,
      "Content-Length": String(workbook.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
