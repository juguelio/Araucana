import { randomBytes } from "node:crypto";

/**
 * El link de una planilla es una capacidad: quien lo tiene puede cargar pasajeros, igual que el
 * código privado de una reserva. Por eso 128 bits y no un identificador corto adivinable.
 */
export function createDepartureSheetToken() {
  return `PLN-${randomBytes(16).toString("hex").toUpperCase()}`;
}

export function isDepartureSheetToken(token: string) {
  return /^PLN-[A-F0-9]{32}$/.test(token);
}
