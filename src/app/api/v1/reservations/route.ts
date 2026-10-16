import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { BookingError, createWebReservation } from "@/lib/booking/repository";
import { createReservationSchema } from "@/lib/booking/validation";

const bookingErrorResponses: Record<string, { message: string; status: number }> = {
  SEAT_OCCUPIED: { message: "El asiento ya esta ocupado", status: 409 },
  SCHEDULE_NOT_FOUND: { message: "Horario no encontrado", status: 404 },
  SEAT_NOT_FOUND: { message: "Asiento no encontrado", status: 404 },
  SCHEDULE_CLOSED: { message: "El horario no esta disponible para reservas", status: 409 },
  CAPACITY_FULL: { message: "No hay suficientes asientos disponibles", status: 409 },
  BOOKING_BUSY: { message: "La salida está recibiendo otras reservas. Intentalo nuevamente.", status: 409 },
  CODE_COLLISION: { message: "No pudimos generar la reserva. Intenta nuevamente", status: 503 }
};

export async function POST(request: Request) {
  try {
    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      return jsonError("INVALID_JSON", "Revisa los datos de la reserva", 400);
    }

    const body = createReservationSchema.safeParse(payload);

    if (!body.success) {
      return jsonError("VALIDATION_ERROR", "Revisa los datos de la reserva", 400);
    }

    const reservation = await createWebReservation(body.data);
    revalidatePath(`/reservar/${reservation.route.slug}`);

    return NextResponse.json({ reservation }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof BookingError) {
      const response = bookingErrorResponses[error.code] ?? { message: error.message, status: 400 };

      return jsonError(error.code, response.message, response.status);
    }

    return handleApiError(error);
  }
}
