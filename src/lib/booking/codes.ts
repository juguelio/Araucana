import { randomBytes, randomInt } from "node:crypto";

const TICKET_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Guest confirmation links are bearer capabilities: 128 bits, never short lookup codes.
export function createReservationCode(now = new Date()) {
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `ARC-${year}${month}-${randomBytes(16).toString("hex").toUpperCase()}`;
}

export function isPrivateReservationCode(code: string) {
  return /^ARC-\d{4}-[A-F0-9]{32}$/.test(code);
}

// Tickets are shown to drivers and printed in the QR, so they must never embed the
// reservation code: that code is the passenger's private link.
export function createTicketCode(now = new Date()) {
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const suffix = Array.from({ length: 8 }, () => TICKET_ALPHABET[randomInt(TICKET_ALPHABET.length)]).join("");
  return `TKT-${year}${month}-${suffix}`;
}
