import { del } from "@vercel/blob";
import { ApiError } from "@/lib/api/responses";
import { requireReservationAccess } from "@/lib/booking/access";
import { attachManualPaymentReceipt, BookingError, getReservationByCode } from "@/lib/booking/repository";
import { storeManualPaymentReceipt } from "./receipt-storage";
import { validateReceiptContent } from "./receipt-validation";

// Checks that do not need the file. The API route runs them before reading the request
// body, so a locked, missing or unconfigured upload never costs a 10 MiB read.
export async function assertReceiptUploadAllowed(code: string, request?: Request) {
  await requireReservationAccess(code, request);
  const reservation = await getReservationByCode(code);
  if (!reservation) throw new BookingError("RESERVATION_NOT_FOUND", "Reserva no encontrada");
  if (reservation.status !== "PENDING_PAYMENT" || reservation.payment?.provider !== "MANUAL" || reservation.payment.status !== "PENDING") {
    throw new ApiError("PAYMENT_LOCKED", "El pago ya no admite comprobantes.", 409);
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new ApiError("RECEIPT_STORAGE_UNAVAILABLE", "La carga de comprobantes no está disponible. Contactá al equipo de Araucana.", 503);
  }
  return reservation;
}

export async function uploadReservationReceipt(code: string, receipt: File, request?: Request) {
  await assertReceiptUploadAllowed(code, request);
  const error = await validateReceiptContent(receipt);
  if (error) throw new ApiError("VALIDATION_ERROR", error, 400);
  const stored = await storeManualPaymentReceipt(code, receipt);
  let result: Awaited<ReturnType<typeof attachManualPaymentReceipt>>;
  try {
    result = await attachManualPaymentReceipt(code, stored);
  } catch (error) {
    await del(stored.blobPathname).catch(() => console.warn("No se pudo limpiar un comprobante sin asociar."));
    throw error;
  }
  // Delete the receipt that was actually replaced inside the transaction, not the one read
  // before storing: with two uploads in a row the earlier read would leave an orphan.
  if (result.replacedBlobPathname && result.replacedBlobPathname !== stored.blobPathname) {
    await del(result.replacedBlobPathname).catch(() => console.warn("No se pudo limpiar el comprobante reemplazado."));
  }
  return result.reservation;
}
