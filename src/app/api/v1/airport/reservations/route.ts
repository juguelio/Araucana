import { NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { createAirportReservation } from "@/lib/airport/booking";
import { BookingError } from "@/lib/booking/repository";

const errorResponses: Record<string, { message: string; status: number }> = {
  ROUTE_NOT_FOUND: { message: "La ruta no está disponible para reservar.", status: 404 },
  FLIGHT_NOT_FOUND: { message: "No encontramos ese vuelo para esa fecha. Revisá el número de vuelo.", status: 404 },
  CAPACITY_FULL: { message: "No quedan lugares en ese vuelo. Probá con otro vuelo del día.", status: 409 },
  SCHEDULE_CLOSED: { message: "Ese vuelo ya no está disponible para reservar.", status: 409 },
  BOOKING_BUSY: { message: "Ese vuelo está recibiendo otras reservas. Intentá nuevamente.", status: 409 },
  CODE_COLLISION: { message: "No pudimos generar la reserva. Intentá nuevamente.", status: 503 }
};

/** Reserva pública de un traslado al aeropuerto: queda atada al número de vuelo. */
export async function POST(request: Request) {
  try {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonError("INVALID_JSON", "Revisá los datos de la reserva.", 400);
    }

    const reservation = await createAirportReservation(payload as never);
    return NextResponse.json({ reservation }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof BookingError) {
      const response = errorResponses[error.code] ?? { message: error.message, status: 400 };
      return jsonError(error.code, response.message, response.status);
    }
    return handleApiError(error);
  }
}
