import { requireReservationAccess } from "@/lib/booking/access";
import { NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { getReservationByCode } from "@/lib/booking/repository";

type RouteParams = {
  params: Promise<{ code: string }>;
};

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;
    await requireReservationAccess(code.toUpperCase(), _request);
    const reservation = await getReservationByCode(code.toUpperCase());

    if (!reservation) {
      return jsonError("RESERVATION_NOT_FOUND", "Reserva no encontrada", 404);
    }

    return NextResponse.json({ reservation }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    return handleApiError(error);
  }
}
