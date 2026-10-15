import { readReceiptFormData } from "@/lib/payments/receipt-form";
import { NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api/responses";
import { uploadReservationReceipt } from "@/lib/payments/receipt-upload";
import { requireReservationAccess } from "@/lib/booking/access";
import { BookingError } from "@/lib/booking/repository";
import { validateReceiptFile } from "@/lib/payments/receipt-storage";

type RouteContext = {
  params: Promise<{ code: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { code } = await context.params;
    const reservationCode = code.toUpperCase();
    await requireReservationAccess(reservationCode, request);
    const formData = await readReceiptFormData(request);
    const receipt = formData.get("receipt");

    if (!(receipt instanceof File)) {
      return jsonError("VALIDATION_ERROR", "Subi un comprobante valido.", 400, {
        receipt: "El archivo receipt es requerido."
      });
    }

    const validationError = validateReceiptFile(receipt);
    if (validationError) {
      return jsonError("VALIDATION_ERROR", validationError, 400, {
        receipt: validationError
      });
    }

    const reservation = await uploadReservationReceipt(reservationCode, receipt, request);

    return NextResponse.json({ reservation }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof BookingError) {
      const status = error.code === "RESERVATION_NOT_FOUND" ? 404 : error.code === "PAYMENT_LOCKED" ? 409 : 400;
      return jsonError(error.code, error.message, status);
    }

    return handleApiError(error);
  }
}
