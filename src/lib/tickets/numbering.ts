/**
 * Numeración de boletos del servicio público (issue #370).
 *
 * Reglas que fijó el cliente y que este módulo hace cumplir:
 * - Una sola serie para toda la empresa, correlativa y continua. No se reinicia por temporada,
 *   año ni servicio: si cada salida arrancara en W001 habría dos W001 el mismo día.
 * - El número se consume al emitir, no al cobrar. Un boleto anulado conserva su número.
 * - La numeración es global; el servicio (fecha, hora, recorrido) es un dato del boleto.
 */

/** Serie de los boletos emitidos por la web. En papel el cliente usa la misma numeración. */
export const SERIE_WEB = "W";

/** Mínimo de dígitos del correlativo: W001, W002… y W1000 cuando pasa de mil. */
const DIGITOS_CORRELATIVO = 3;

/**
 * Sólo el servicio público lleva boleto numerado. Aeropuerto y Chapelco se venden con su
 * propio comprobante y un charter no es un servicio regular.
 */
export function requiereBoletoNumerado(bookingMode: string | null | undefined): boolean {
  return bookingMode === "SEATED";
}

/** `W001` — el número como se lee, se dicta y se imprime. */
export function formatTicketNumber(series: string, numero: number): string {
  if (!Number.isInteger(numero) || numero < 1) {
    throw new Error(`Número de boleto inválido: ${numero}`);
  }
  return `${series}${String(numero).padStart(DIGITOS_CORRELATIVO, "0")}`;
}

/**
 * Vuelta atrás de `formatTicketNumber`, para buscar un boleto por lo que el pasajero muestra.
 * Devuelve `null` si el texto no tiene forma de número de boleto.
 */
export function parseTicketNumber(texto: string): { series: string; numero: number } | null {
  const limpio = texto.trim().toUpperCase().replace(/\s+/g, "");
  const match = /^([A-Z]{1,3})(\d{1,9})$/.exec(limpio);
  if (!match) return null;

  const numero = Number(match[2]);
  if (!Number.isInteger(numero) || numero < 1) return null;

  return { series: match[1], numero };
}
