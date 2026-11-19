/**
 * Precio de una reserva que se está editando (#267).
 *
 * El operador puede corregir la cantidad de pasajeros y el equipaje deportivo. Ninguno de los dos
 * campos guarda su propio importe: el total se arma con la tarifa de la ruta y los adicionales que
 * ya tiene la reserva —`sportsLuggageUnitCents` y `zoneExtraCents` se congelan al vender, así que
 * una suba de precios posterior no toca una reserva vieja—.
 *
 * La decisión de pisar o no el total es pura y se prueba sin base: si el total guardado no coincide
 * con el que sale de sus datos, el operador lo corrigió a mano y se respeta tal cual. La transacción
 * de `manageReservation` sólo trae los datos y aplica la cuenta.
 */
import { fareCounts, hasFullFare, reservationTotalCents, sinAdultoMensaje } from "./passenger-fares";
import { getStopFares } from "./stop-fares";

/**
 * Tope de una reserva, no del servicio: es el máximo que vende el alta de Chapelco (60 personas) y
 * el que tiene que aceptar la edición. El cupo real lo decide cada servicio.
 */
export const MAX_PASSENGERS = 60;

export type ReservationPriceBasis = {
  /** Tarifa por pasajero de la ruta asociada a la reserva. */
  priceCents: number;
  /** Pasajeros y tarifas de menores guardados hoy en la reserva. */
  passengerCount: number;
  halfFareCount: number;
  freeFareCount: number;
  /** Adicionales del aeropuerto guardados hoy (0 en las reservas que no son del aeropuerto). */
  zoneExtraCents: number;
  sportsLuggageCount: number;
  sportsLuggageUnitCents: number;
};

/** El total que sale de los datos de la reserva: tarifa por pasajero con menores más adicionales. */
export function totalDerivadoCents(basis: ReservationPriceBasis) {
  const tarifas = fareCounts(basis.passengerCount, basis.halfFareCount, basis.freeFareCount);
  return reservationTotalCents(basis.priceCents, tarifas)
    + basis.zoneExtraCents
    + basis.sportsLuggageCount * basis.sportsLuggageUnitCents;
}

export type TotalAlEditar = {
  /** Total que quedaría guardado con los cambios pedidos. */
  totalCents: number;
  /** Diferencia contra el total guardado: puede ser 0 o negativa. */
  deltaCents: number;
  /** `false` = el total guardado fue corregido a mano y no se recalcula. */
  seRecalcula: boolean;
};

/**
 * El total que corresponde después de editar la cantidad o el equipaje deportivo.
 *
 * Si el total guardado no es el derivado, hubo una corrección a mano: se devuelve ese mismo total y
 * no se toca. Si coincide, se recalcula con los datos de la reserva (no con la configuración de hoy).
 */
export function totalAlEditar(input: {
  basis: ReservationPriceBasis;
  /** Total guardado hoy, el que puede tener una corrección a mano. */
  totalCents: number;
  passengerCount?: number;
  sportsLuggageCount?: number;
  /** Menores (media tarifa y sin cargo): van dentro de `passengerCount`. */
  halfFareCount?: number;
  freeFareCount?: number;
  /** Recargo por zona después de mover el punto del traslado. */
  zoneExtraCents?: number;
  /** Tarifa por persona después de cambiar la bajada (parada intermedia o destino final). */
  priceCents?: number;
}): TotalAlEditar {
  const { basis, totalCents } = input;
  if (totalDerivadoCents(basis) !== totalCents) {
    return { totalCents, deltaCents: 0, seRecalcula: false };
  }
  const siguiente = totalDerivadoCents({
    ...basis,
    priceCents: input.priceCents ?? basis.priceCents,
    passengerCount: input.passengerCount ?? basis.passengerCount,
    halfFareCount: input.halfFareCount ?? basis.halfFareCount,
    freeFareCount: input.freeFareCount ?? basis.freeFareCount,
    zoneExtraCents: input.zoneExtraCents ?? basis.zoneExtraCents,
    sportsLuggageCount: input.sportsLuggageCount ?? basis.sportsLuggageCount
  });
  return { totalCents: siguiente, deltaCents: siguiente - totalCents, seRecalcula: true };
}

/**
 * La cantidad mínima: los menores ya cargados van dentro del total y siempre tiene que quedar al
 * menos un pasajero de tarifa entera —la misma regla que el alta—. Bajarla dejaría una reserva con
 * más menores que lugares o sin nadie que pague.
 */
export function minimoDePasajeros(basis: Pick<ReservationPriceBasis, "halfFareCount" | "freeFareCount">) {
  return Math.max(1, basis.halfFareCount + basis.freeFareCount + 1);
}

/**
 * Tarifa por persona de una reserva de ruta: la de la parada donde baja si tiene bajada
 * intermedia, o la de la ruta entera. Es la misma cuenta que hace el alta.
 */
export function tarifaPorPersona(
  route: { from: string; to: string; priceCents: number; stops?: unknown },
  dropoffStop: string | null | undefined
): number {
  if (!dropoffStop) return route.priceCents;
  return getStopFares(route).find((fare) => fare.name === dropoffStop)?.priceCents ?? route.priceCents;
}

/**
 * Valida la combinación de pasajeros y menores que va a quedar guardada. Devuelve el mensaje de
 * error o `null`. Mismas reglas que el alta: los menores van dentro del total y siempre queda
 * al menos un pasajero de tarifa entera.
 */
export function errorDeMenores(counts: { passengerCount: number; halfFareCount: number; freeFareCount: number }): string | null {
  const { passengerCount, halfFareCount, freeFareCount } = counts;
  if (halfFareCount < 0 || freeFareCount < 0) return "La cantidad de menores no puede ser negativa.";
  if (halfFareCount + freeFareCount > passengerCount) return "La cantidad de menores no puede superar la de pasajeros.";
  if (!hasFullFare(fareCounts(passengerCount, halfFareCount, freeFareCount))) return sinAdultoMensaje;
  return null;
}
