import { NextResponse } from "next/server";
import { cuposDeReserva, limitarPedido } from "@/lib/api/rate-limit";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { createAirportRoundTripReservation } from "@/lib/airport/booking";
import { BookingError } from "@/lib/booking/repository";
import { airportRoundTripSchema } from "@/lib/airport/validation";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { AIRPORT_ERROR_RESPONSES, pickupCoverageError } from "@/lib/airport/api-shared";

import type { ReservationCreationContext } from "@/lib/booking/reservation-creator";
import { getAppUserFromToken, getTokenFromRequest } from "@/lib/auth/service";

/** Lo que necesita el pasajero para pagar y abrir cada tramo. */
function resumenTramo(reservation: {
  code: string;
  shortCode: string;
  totalCents: number;
  currency: string;
  airportDetails?: { flightNumber: string; direction: string; serviceDate: Date } | null;
}) {
  return {
    code: reservation.code,
    shortCode: reservation.shortCode,
    totalCents: reservation.totalCents,
    currency: reservation.currency,
    flightNumber: reservation.airportDetails?.flightNumber ?? null,
    direction: reservation.airportDetails?.direction ?? null,
    serviceDate: reservation.airportDetails?.serviceDate ?? null
  };
}

/**
 * Ida y vuelta del aeropuerto (#36): crea las dos reservas enlazadas (mismo `roundTripId`) con los
 * datos del pasajero una sola vez. Cada tramo queda con su pago pendiente.
 */
export async function POST(request: Request) {
  const rafaga = await limitarPedido(request, cuposDeReserva);
  if (rafaga) return rafaga;

  try {
    const context: ReservationCreationContext = { creator: await getAppUserFromToken(getTokenFromRequest(request)) };

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonError("INVALID_JSON", "Revisá los datos de la reserva.", 400);
    }

    const parsed = airportRoundTripSchema.safeParse(payload);
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Revisá los datos de la reserva.", 400);
    }

    const input = parsed.data;
    const coverage = await getAirportCoverage();
    const errorLlegada = pickupCoverageError(input.arrival, coverage, "llegada");
    if (errorLlegada) return errorLlegada;
    const errorVuelta = pickupCoverageError(input.departure, coverage, "vuelta");
    if (errorVuelta) return errorVuelta;

    const { roundTripId, arrival, departure } = await createAirportRoundTripReservation(input, context);
    return NextResponse.json(
      { roundTrip: { id: roundTripId, arrival: resumenTramo(arrival), departure: resumenTramo(departure) } },
      { status: 201, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    if (error instanceof BookingError) {
      const response = AIRPORT_ERROR_RESPONSES[error.code] ?? { message: error.message, status: 400 };
      return jsonError(error.code, response.message, response.status);
    }
    return handleApiError(error);
  }
}
