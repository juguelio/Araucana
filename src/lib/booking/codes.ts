import { randomBytes } from "node:crypto";

// Guest confirmation links are bearer capabilities: 128 bits, never short lookup codes.
export function createReservationCode(now = new Date()) {
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `ARC-${year}${month}-${randomBytes(16).toString("hex").toUpperCase()}`;
}

export function isPrivateReservationCode(code: string) {
  return /^ARC-\d{4}-[A-F0-9]{32}$/.test(code);
}

export function createTicketCode(reservationCode: string) {
  return `TKT-${reservationCode.toUpperCase()}`;
}
