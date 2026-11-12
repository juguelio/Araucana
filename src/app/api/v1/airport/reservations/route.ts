import { NextResponse } from "next/server";
import { cuposDeReserva, limitarPedido } from "@/lib/api/rate-limit";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { createAirportReservation } from "@/lib/airport/booking";
import { BookingError } from "@/lib/booking/repository";
import { adminAirportReservationSchema, airportReservationSchema } from "@/lib/airport/validation";
import { isInsideAirportPickupZone, OUTSIDE_PICKUP_ZONE } from "@/lib/airport/pickup-zone";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { AIRPORT_ERROR_RESPONSES } from "@/lib/airport/api-shared";

import type { ReservationCreationContext } from "@/lib/booking/reservation-creator";
import { getAppUserFromToken, getTokenFromRequest, requireReservationsUser } from "@/lib/auth/service";

/** Reserva pública de un traslado al aeropuerto: queda atada al número de vuelo. */
export async function POST(request: Request) {
  // El alta desde el panel es de un usuario logueado: el freno es para el formulario público.
  if (new URL(request.url).searchParams.get("source") !== "admin") {
    const rafaga = await limitarPedido(request, cuposDeReserva);
    if (rafaga) return rafaga;
  }

  try {
    const fromAdmin = new URL(request.url).searchParams.get("source") === "admin";
    const context: ReservationCreationContext = fromAdmin
      ? { fromAdmin: true, creator: await requireReservationsUser(request) }
      : { creator: await getAppUserFromToken(getTokenFromRequest(request)) };

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonError("INVALID_JSON", "Revisá los datos de la reserva.", 400);
    }

    const parsed = (fromAdmin ? adminAirportReservationSchema : airportReservationSchema).safeParse(payload);
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Revisá los datos de la reserva.", 400);
    }
    const input = parsed.data;
    const coverage = await getAirportCoverage();
    if (!input.pickupPoint && (coverage.enabled || input.pickupAddress?.trim())) {
      return jsonError("PICKUP_POINT_REQUIRED", "Confirmá el punto del traslado en el mapa.", 400);
    }
    if (coverage.enabled && input.pickupPoint && !isInsideAirportPickupZone(input.pickupPoint, coverage)) {
      return jsonError("OUTSIDE_PICKUP_ZONE", OUTSIDE_PICKUP_ZONE, 422);
    }
    const reservation = await createAirportReservation(input, context);
    return NextResponse.json({ reservation }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof BookingError) {
      const response = AIRPORT_ERROR_RESPONSES[error.code] ?? { message: error.message, status: 400 };
      return jsonError(error.code, response.message, response.status);
    }
    return handleApiError(error);
  }
}
