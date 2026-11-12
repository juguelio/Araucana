import { randomBytes, randomInt } from "node:crypto";

// Alfabeto para códigos que se dictan por teléfono o se anotan a mano: sin 0/O ni 1/I,
// que son los que se confunden al leer un comprobante o escuchar un número.
const HUMAN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Guest confirmation links are bearer capabilities: 128 bits, never short lookup codes.
export function createReservationCode(now = new Date()) {
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `ARC-${year}${month}-${randomBytes(16).toString("hex").toUpperCase()}`;
}

export function isPrivateReservationCode(code: string) {
  return /^ARC-\d{4}-[A-F0-9]{32}$/.test(code);
}

export const SHORT_CODE_LENGTH = 8;

/**
 * Código corto de la reserva (issue #75): el que se dicta por teléfono, se imprime en el
 * comprobante y se tipea en el buscador del panel.
 *
 * No es una capability: 32^8 (≈1,1 billones) combinaciones para que no se adivine, pero la
 * reserva se abre **sólo** con `createReservationCode()`. Este código lo resuelve el buscador
 * del panel, que exige sesión de ADMIN/SECRETARY, así que nunca da acceso a un tercero
 * (ver `isPrivateReservationCode()` y `requireReservationAccess()`).
 */
export function createReservationShortCode() {
  return Array.from({ length: SHORT_CODE_LENGTH }, () => HUMAN_ALPHABET[randomInt(HUMAN_ALPHABET.length)]).join("");
}

/** Forma de búsqueda: "abcd-2345", "ABCD 2345" y "abcd2345" son el mismo código. */
export function normalizeShortCode(input: string) {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isShortCode(input: string) {
  const code = normalizeShortCode(input);
  return code.length === SHORT_CODE_LENGTH && [...code].every((character) => HUMAN_ALPHABET.includes(character));
}

/** Cómo se muestra: en dos bloques de cuatro, que es como se dicta ("ABCD-2345"). */
export function formatShortCode(code: string) {
  const normalized = normalizeShortCode(code);
  return normalized.length === SHORT_CODE_LENGTH
    ? `${normalized.slice(0, 4)}-${normalized.slice(4)}`
    : normalized;
}

// Tickets are shown to drivers and printed in the QR, so they must never embed the
// reservation code: that code is the passenger's private link.
export function createTicketCode(now = new Date()) {
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const suffix = Array.from({ length: 8 }, () => HUMAN_ALPHABET[randomInt(HUMAN_ALPHABET.length)]).join("");
  return `TKT-${year}${month}-${suffix}`;
}
