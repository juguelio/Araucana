import { z } from "zod";
import { parseMoney } from "@/lib/special-trips/data";

export const reservationPriceError = "Ingresá un precio válido, sin separadores de miles y con hasta dos decimales.";

export const reservationPriceCents = z.number().int().min(0).max(2_147_483_647);

export function parseReservationPrice(value: string) {
  return parseMoney(value.trim());
}

export function canCorrectManualPayment(status: string, payment?: { provider: string; status: string } | null) {
  return (status === "PENDING_PAYMENT" || status === "CONFIRMED") &&
    payment?.provider === "MANUAL" && payment.status === "APPROVED";
}

export function canEditReservationTotal(status: string, payment?: {
  provider: string;
  status: string;
  receiptBlobPathname?: string | null;
} | null) {
  return status === "PENDING_PAYMENT" && (!payment || (
    payment.provider === "MANUAL" && (
      payment.status === "REJECTED" || (payment.status === "PENDING" && !payment.receiptBlobPathname)
    )
  ));
}

export function canRegisterManualPayment(status: string, totalCents: number, payment?: { provider: string; status: string } | null) {
  return (status === "PENDING_PAYMENT" || status === "CONFIRMED") && totalCents > 0 &&
    (!payment || (payment.provider === "MANUAL" && (payment.status === "PENDING" || payment.status === "REJECTED")));
}
