import { AuthorizationError, requireReservationsUser } from "@/lib/auth/service";
import { getAirportServiceOrderReservations } from "@/lib/airport/service-order-repository";
import {
  buildServiceOrderBlocks,
  buildServiceOrderWorkbook,
  serviceOrderFileName
} from "@/lib/airport/service-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Hoy en San Martín de los Andes, como `YYYY-MM-DD`. */
function diaDeHoy() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Salta" }).format(new Date());
}

/**
 * Orden de servicio del día: el .xlsx que se le entrega al chofer, con la forma de la planilla en
 * papel del cliente (foto del 2026-11-12, issue #74). Mismo permiso que el resto de la operación.
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

  const date = new URL(request.url).searchParams.get("date") ?? diaDeHoy();

  if (!DATE_PATTERN.test(date)) {
    return new Response("Fecha inválida: se espera YYYY-MM-DD", { status: 400 });
  }

  const generatedAt = new Date();
  const reservas = await getAirportServiceOrderReservations(date);
  const blocks = buildServiceOrderBlocks(reservas);
  const workbook = await buildServiceOrderWorkbook({ date, generatedAt }, blocks);

  return new Response(new Uint8Array(workbook), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${serviceOrderFileName(date)}"`,
      "Content-Length": String(workbook.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
