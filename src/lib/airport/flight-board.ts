import { flightEvidenceWarning, reliableEstimate, type FlightEvidence } from "./data-quality";
/**
 * Orden del tablero de aeropuerto (`/admin/aeropuerto`).
 *
 * La operación mira el tablero desde el próximo vuelo: el que ya pasó no puede seguir arriba del
 * día, pero tampoco desaparecer —el chofer y el operador todavía tienen que poder abrirlo para
 * ver pasajeros, combi asignada y la hoja del chofer—. Por eso los vuelos terminados bajan a un
 * bloque plegado y en gris, y lo que sigue en juego queda ordenado por el horario real.
 *
 * Distinto del selector de reserva (`flight-selector.ts`): ahí el criterio es «se puede reservar
 * o no». Acá es «todavía no pasó».
 */

/** Margen tras el horario para pedir verificación; nunca implica aterrizaje confirmado. */
export const MARGEN_TERMINADO_MIN = 90;

export type VueloConHorario = FlightEvidence;

/** El horario que manda: el estimado si lo hay, si no el programado. */
export function horaDeReferencia(vuelo: VueloConHorario): Date {
  return reliableEstimate(vuelo) ?? vuelo.scheduledAt;
}

/**
 * ¿Ya pasó? Aterrizado sí; cancelado o desviado NO, porque son imprevistos que hay que seguir
 * viendo. El paso del tiempo no prueba que un avión haya llegado: ese caso se manda a verificar.
 */
export function vueloTerminado(vuelo: VueloConHorario, ahora: Date): boolean {
  if (flightEvidenceWarning(vuelo, ahora) || ["CANCELLED", "DIVERTED"].includes(vuelo.status)) return false;
  return vuelo.status === "LANDED" || (vuelo.direction === "DEPARTURE" && vuelo.status === "EN_ROUTE");
}

/**
 * Parte la lista del día en lo que sigue en juego y lo que ya pasó, cada uno por horario real
 * ascendente: el más cercano siempre arriba.
 */
export function separarVuelosDelTablero<T extends VueloConHorario>(
  vuelos: readonly T[],
  ahora: Date,
  margenMin = MARGEN_TERMINADO_MIN
): { enJuego: T[]; terminados: T[]; porVerificar: T[] } {
  const enJuego: T[] = [];
  const terminados: T[] = [];
  const porVerificar: T[] = [];

  for (const vuelo of vuelos) {
    if (flightEvidenceWarning(vuelo, ahora)) porVerificar.push(vuelo);
    else if (vueloTerminado(vuelo, ahora)) terminados.push(vuelo);
    else if (!["CANCELLED", "DIVERTED"].includes(vuelo.status) && ahora.getTime() - horaDeReferencia(vuelo).getTime() > margenMin * 60000) porVerificar.push(vuelo);
    else enJuego.push(vuelo);
  }

  const porHorario = (a: VueloConHorario, b: VueloConHorario) => horaDeReferencia(a).getTime() - horaDeReferencia(b).getTime();
  enJuego.sort(porHorario);
  terminados.sort(porHorario);

  porVerificar.sort(porHorario);
  return { enJuego, terminados, porVerificar };
}
