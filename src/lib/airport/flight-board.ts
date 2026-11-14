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
import { horaEfectivaDelVuelo } from "./effective-time";

/** Cuánto se espera después del horario para dar un vuelo por terminado si nadie marcó «Aterrizó». */
export const MARGEN_TERMINADO_MIN = 90;

export type VueloConHorario = {
  status: string;
  scheduledAt: Date;
  estimatedAt: Date | null;
};

/** El horario que manda: el estimado si lo hay, si no el programado. Misma cuenta que la planilla. */
export function horaDeReferencia(vuelo: VueloConHorario): Date {
  return horaEfectivaDelVuelo(vuelo);
}

/**
 * ¿Ya pasó? Aterrizado sí; cancelado o desviado NO, porque son imprevistos que hay que seguir
 * viendo. El resto se da por terminado cuando pasó el margen desde su horario real: el tablero no
 * siempre recibe el «Aterrizó» de la aerolínea.
 */
export function vueloTerminado(vuelo: VueloConHorario, ahora: Date, margenMin = MARGEN_TERMINADO_MIN): boolean {
  if (["CANCELLED", "DIVERTED"].includes(vuelo.status)) return false;
  if (vuelo.status === "LANDED") return true;
  return ahora.getTime() - horaDeReferencia(vuelo).getTime() > margenMin * 60000;
}

/**
 * Parte la lista del día en lo que sigue en juego y lo que ya pasó, cada uno por horario real
 * ascendente: el más cercano siempre arriba.
 */
export function separarVuelosDelTablero<T extends VueloConHorario>(
  vuelos: readonly T[],
  ahora: Date,
  margenMin = MARGEN_TERMINADO_MIN
): { enJuego: T[]; terminados: T[] } {
  const enJuego: T[] = [];
  const terminados: T[] = [];

  for (const vuelo of vuelos) {
    (vueloTerminado(vuelo, ahora, margenMin) ? terminados : enJuego).push(vuelo);
  }

  const porHorario = (a: VueloConHorario, b: VueloConHorario) => horaDeReferencia(a).getTime() - horaDeReferencia(b).getTime();
  enJuego.sort(porHorario);
  terminados.sort(porHorario);

  return { enJuego, terminados };
}
