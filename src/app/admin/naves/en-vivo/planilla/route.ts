import { AuthorizationError, requireReservationsUser } from "@/lib/auth/service";
import { recordDownload } from "@/lib/audit/download";
import { cargarDiaDeFlota } from "@/lib/driver/dia";
import { fechaLocal, rangoDelDia } from "@/lib/driver/jornada";
import { buildJornadaWorkbook, nombreArchivoJornada } from "@/lib/driver/jornada-xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Planilla del resumen del día en Excel: la misma cuenta que la pantalla, para archivar o mandar.
 * `?fecha=YYYY-MM-DD`; sin fecha válida se toma el día argentino de hoy.
 */
export async function GET(request: Request) {
  let downloader;
  try {
    downloader = await requireReservationsUser(request);
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response("No autorizado", { status: 401 });
    throw error;
  }

  const pedida = new URL(request.url).searchParams.get("fecha") ?? "";
  const fecha = rangoDelDia(pedida) ? pedida : fechaLocal(new Date());
  const dia = await cargarDiaDeFlota(fecha);
  if (!dia) return new Response("No encontramos ese día", { status: 404 });

  const nombre = nombreArchivoJornada(fecha);
  const buffer = await buildJornadaWorkbook(dia, { generatedAt: new Date() });

  await recordDownload(request, downloader, {
    entity: "VEHICLE",
    entityId: null,
    entityLabel: nombre,
    summary: `Resumen del día de naves ${fecha} descargado.`
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store"
    }
  });
}
