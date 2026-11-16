import { AuthorizationError, requireReservationsUser } from "@/lib/auth/service";
import { getDepartureSheetById } from "@/lib/departure-sheets/repository";
import { buildDepartureSheetWorkbook, departureSheetFileBase } from "@/lib/departure-sheets/export";
import { recordDownload } from "@/lib/audit/download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Descarga la planilla con los mismos datos que muestra el detalle. ADMIN y SECRETARY. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let downloader;
  try {
    downloader = await requireReservationsUser(request);
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

  await recordDownload(request, downloader, {
    entity: "DEPARTURE_SHEET", entityId: sheet.id, entityLabel: `${sheet.kind} · ${trip.client}`.slice(0, 200),
    summary: `Planilla de salida descargada con ${sheet.passengers.length} pasajeros.`
  });

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
