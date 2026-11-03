import { NextResponse } from "next/server";
import { approveAdminApiReservationPayment } from "@/lib/admin/api";
import { BookingError } from "@/lib/booking/repository";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { requireAdminApi } from "../../../_utils";

type RouteContext = {
  params: Promise<{ code: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    await requireAdminApi(request);
    const { code } = await context.params;
    return NextResponse.json({ reservation: await approveAdminApiReservationPayment(code) });
  } catch (error) {
    if (error instanceof BookingError) {
      const status = ["RESERVATION_NOT_FOUND", "PAYMENT_NOT_FOUND"].includes(error.code) ? 404 : 409;
      return jsonError(error.code, error.message, status);
    }
    return handleApiError(error);
  }
}
