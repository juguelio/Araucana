"use server";

import { revalidatePath } from "next/cache";
import { getAppUserFromToken } from "@/lib/auth/service";
import { BookingError, createWebReservation } from "@/lib/booking/repository";
import { createReservationSchema, type CreateReservationInput } from "@/lib/booking/validation";

type ReservationActionResult =
  | {
      ok: true;
      code: string;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: ReservationFieldErrors;
    };

type ReservationFieldErrors = Partial<
  Record<"firstName" | "lastName" | "email" | "phone" | "documentType" | "documentId" | "nationality", string>
>;

const bookingMessages: Record<string, string> = {
  SEAT_OCCUPIED: "Ese asiento ya fue reservado. Elegi otro asiento.",
  SCHEDULE_NOT_FOUND: "La salida seleccionada ya no esta disponible.",
  SEAT_NOT_FOUND: "El asiento seleccionado no existe para esta salida.",
  DISABILITY_FARE_NOT_AVAILABLE: "La solicitud de viaje gratuito corresponde a un pasajero de transporte público.",
  STOP_NOT_AVAILABLE: "La parada seleccionada ya no está disponible. Actualizá la página y volvé a elegir.",
  SCHEDULE_CLOSED: "La salida seleccionada ya no acepta reservas.",
  AIRPORT_SCHEDULE_NOT_BOOKABLE: "El aeropuerto se reserva eligiendo el vuelo, no por horario.",
  CAPACITY_FULL: "No hay suficientes asientos disponibles para esa cantidad.",
  BOOKING_BUSY: "La salida está recibiendo otras reservas. Intentalo nuevamente.",
  CODE_COLLISION: "No pudimos generar el codigo de reserva. Intentalo nuevamente."
};

export async function createReservationAction(input: CreateReservationInput): Promise<ReservationActionResult> {
  const parsed = createReservationSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors: ReservationFieldErrors = {};

    for (const issue of parsed.error.issues) {
      const [scope, field] = issue.path;

      if (scope === "passenger" && typeof field === "string" && !(field in fieldErrors)) {
        fieldErrors[field as keyof ReservationFieldErrors] = issue.message;
      }
    }

    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors
    };
  }

  try {
    const creator = await getAppUserFromToken();
    const reservation = await createWebReservation(parsed.data, { creator });
    revalidatePath(`/reservar/${reservation.route.slug}`);

    return {
      ok: true,
      code: reservation.code
    };
  } catch (error) {
    if (error instanceof BookingError) {
      return {
        ok: false,
        message: bookingMessages[error.code] ?? "No pudimos crear la reserva. Intentalo nuevamente."
      };
    }

    return {
      ok: false,
      message: "No pudimos crear la reserva. Intentalo nuevamente."
    };
  }
}
