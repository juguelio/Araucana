import { AuthorizationError, requireReservationsUser } from "@/lib/auth/service";
import { getDepartureSheetById } from "@/lib/departure-sheets/repository";
import { buildDepartureSheetWorkbook, departureSheetFileBase } from "@/lib/departure-sheets/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Descarga la planilla con los mismos datos que muestra el detalle. ADMIN y SECRETARY. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireReservationsUser(request);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new Response("No autorizado", { status: 401 });
    }
    throw error;
  }

  const { id } = await params;
  const sheet = await getDepartureSheetById(id);

  if (!sheet) {
    return new Response("No encontramos la planilla", { status: 404 });
  }

  const trip = sheet.specialTrip;
  const day = trip.serviceDate.toISOString().slice(0, 10);
  const meta = { kind: sheet.kind, reference: `${day} ${trip.client}` };
  const workbook = await buildDepartureSheetWorkbook(meta, sheet.passengers);

  return new Response(new Uint8Array(workbook), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${departureSheetFileBase(meta)}.xlsx"`,
      "Content-Length": String(workbook.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
