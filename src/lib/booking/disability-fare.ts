import type { ReservationDetailDto } from "./types";

export const DISABILITY_DOCUMENT_PROVIDER = "DISABILITY_DOCUMENT";
export const DISABILITY_PENDING_STATUS = "DOCUMENTATION_PENDING";

export function receiptPendingStatus(provider?: string | null) {
  if (provider === DISABILITY_DOCUMENT_PROVIDER) return DISABILITY_PENDING_STATUS;
  if (provider === "MANUAL") return "PENDING_PAYMENT";
  return null;
}

export function redactDisabilityReceipt(reservation: ReservationDetailDto): ReservationDetailDto {
  if (reservation.payment?.provider !== DISABILITY_DOCUMENT_PROVIDER) return reservation;
  return {
    ...reservation,
    payment: {
      ...reservation.payment,
      receiptBlobUrl: null,
      receiptBlobPathname: null,
      receiptFileName: null
    }
  };
}
