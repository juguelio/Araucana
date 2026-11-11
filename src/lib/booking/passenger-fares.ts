/**
 * Tarifas por edad para todo lo que se vende por persona.
 *
 * Regla de la agencia (issue #33):
 * - desde 9 años: tarifa entera;
 * - 4 a 8 años: media tarifa;
 * - menores de 4: no pagan, pero igual ocupan un lugar (decisión de la agencia).
 */
export type FareCounts = { full: number; half: number; free: number };

/** Media tarifa: mitad exacta del precio de la ruta (18.000 → 9.000). */
export function halfFareCents(priceCents: number) {
  return Math.round(priceCents / 2);
}

/** Todos los pasajeros ocupan un lugar, paguen o no. */
export function seatsFromFares(counts: FareCounts) {
  return counts.full + counts.half + counts.free;
}

/** Total en centavos: la tarifa entera por adulto, la mitad por menor de 4 a 8. */
export function reservationTotalCents(priceCents: number, counts: FareCounts) {
  return priceCents * counts.full + halfFareCents(priceCents) * counts.half;
}

/**
 * Compatibilidad: las reservas viejas sólo tienen `passengerCount` y se leen como
 * todos tarifa entera. Los contadores de media y sin cargo se restan de ese total.
 */
export function fareCounts(passengerCount: number, half = 0, free = 0): FareCounts {
  const halfSan = Math.max(Math.trunc(half) || 0, 0);
  const freeSan = Math.max(Math.trunc(free) || 0, 0);
  const total = Math.max(Math.trunc(passengerCount) || 0, 0);
  return { full: Math.max(total - halfSan - freeSan, 0), half: halfSan, free: freeSan };
}

/**
 * Una reserva necesita al menos un pasajero de tarifa entera: un grupo de sólo menores
 * no es una venta real y dejaba crear reservas de $0 declarando a todos «menores de 4».
 */
export function hasFullFare(counts: FareCounts) {
  return counts.full >= 1;
}

export const sinAdultoMensaje = "Tiene que haber al menos un pasajero de tarifa entera (9 años o más).";

/** Texto corto para comprobantes y listados. */
export function fareSummary(counts: FareCounts) {
  const partes: string[] = [];
  if (counts.half) partes.push(`${counts.half} con media tarifa`);
  if (counts.free) partes.push(`${counts.free} sin cargo`);
  return partes.join(" · ");
}
