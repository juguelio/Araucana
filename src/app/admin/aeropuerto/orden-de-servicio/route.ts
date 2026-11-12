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
 * Orden de servicio: el .xlsx que se le entrega al chofer, con la forma de la planilla en papel del
 * cliente (foto del 2026-11-12, issue #74).
 *
 * - `?date=YYYY-MM-DD` — el día completo, con un bloque por vuelo (la hoja del turno).
 * - `?date=…&flight=<id>` — sólo ese vuelo, para entregar una hoja por servicio.
 *
 * Mismo permiso que el resto de la operación.
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
  const date = params.get("date") ?? diaDeHoy();
  const flightId = params.get("flight") || null;

  if (!DATE_PATTERN.test(date)) {
    return new Response("Fecha inválida: se espera YYYY-MM-DD", { status: 400 });
  }

  const generatedAt = new Date();
  const reservas = await getAirportServiceOrderReservations(date, flightId);
  const blocks = buildServiceOrderBlocks(reservas);
  const workbook = await buildServiceOrderWorkbook({ date, generatedAt }, blocks);
  const referencia = flightId ? (blocks[0]?.flightNumber ?? flightId) : null;

  return new Response(new Uint8Array(workbook), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${serviceOrderFileName(date, referencia)}"`,
      "Content-Length": String(workbook.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
