import { flightEvidenceWarning, reliableEstimate, type FlightEvidence } from "./data-quality";
import { horaEfectivaDelVuelo } from "./effective-time";
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

/**
 * Pasado este margen el vuelo ya no se puede verificar en la operación: baja al pie como terminado
 * sin confirmar. Sin tope, un vuelo que la fuente nunca confirma —Chapelco en temporada baja, o
 * AirLabs caído— se quedaba en «Por verificar» el resto del día y tapaba lo que sí seguía en juego.
 * Un vuelo de Chapelco no está cuatro horas en el aire.
 */
export const MARGEN_SIN_CONFIRMAR_MIN = 240;

export type VueloConHorario = FlightEvidence;

/**
 * Las versiones anteriores proyectaban horarios desde el historial. El panel identifica estas
 * filas por la fuente y la ausencia de una lectura operativa.
 */
export function esProyeccion(vuelo: Pick<VueloConHorario, "source" | "lastCheckedAt">): boolean {
  return vuelo.source === "ESTIMADO" && !vuelo.lastCheckedAt;
}

/**
 * Qué vuelos del día van al tablero del panel.
 *
 * - Si alguna fuente confirmó al menos un vuelo ese día, las proyecciones quedan afuera: en un día
 *   con datos reales, una proyección es un vuelo fantasma (AR1653 del 17/11, reportado dos veces).
 * - Cuando sólo quedan proyecciones históricas, el panel puede mostrarlas para revisión de
 *   Operaciones. El selector de reservas excluye todas las filas ESTIMADO.
 */
export function vuelosParaElTablero<T extends Pick<VueloConHorario, "source" | "lastCheckedAt">>(
  vuelos: readonly T[]
): { tablero: T[]; fantasma: T[]; soloProyecciones: boolean } {
  const confirmados = vuelos.filter((v) => !esProyeccion(v));
  if (confirmados.length > 0) {
    return { tablero: confirmados, fantasma: vuelos.filter((v) => esProyeccion(v)), soloProyecciones: false };
  }
  return { tablero: [...vuelos], fantasma: [], soloProyecciones: vuelos.length > 0 };
}

/** El horario que manda: el estimado si lo hay, si no el programado. */
export function horaDeReferencia(vuelo: VueloConHorario): Date {
  // La estima 00:00 del tablero no es medianoche: `reliableEstimate` la descarta y manda la programada.
  return horaEfectivaDelVuelo({ scheduledAt: vuelo.scheduledAt, estimatedAt: reliableEstimate(vuelo) });
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
  margenMin = MARGEN_TERMINADO_MIN,
  margenSinConfirmarMin = MARGEN_SIN_CONFIRMAR_MIN
): { enJuego: T[]; terminados: T[]; porVerificar: T[]; proyectados: T[] } {
  const enJuego: T[] = [];
  const terminados: T[] = [];
  const porVerificar: T[] = [];
  const proyectados: T[] = [];

  for (const vuelo of vuelos) {
    // Una proyeccion no es evidencia de nada: se aparta antes de clasificar por horario.
    if (esProyeccion(vuelo)) proyectados.push(vuelo);
    else if (flightEvidenceWarning(vuelo, ahora)) porVerificar.push(vuelo);
    else if (vueloTerminado(vuelo, ahora)) terminados.push(vuelo);
    else if (
      !["CANCELLED", "DIVERTED"].includes(vuelo.status) &&
      ahora.getTime() - horaDeReferencia(vuelo).getTime() > margenSinConfirmarMin * 60000
    ) {
      // Ya no hay nada que verificar: el vuelo pasó hace horas y la fuente no lo va a confirmar.
      terminados.push(vuelo);
    } else if (!["CANCELLED", "DIVERTED"].includes(vuelo.status) && ahora.getTime() - horaDeReferencia(vuelo).getTime() > margenMin * 60000) porVerificar.push(vuelo);
    else enJuego.push(vuelo);
  }

  const porHorario = (a: VueloConHorario, b: VueloConHorario) => horaDeReferencia(a).getTime() - horaDeReferencia(b).getTime();
  enJuego.sort(porHorario);
  terminados.sort(porHorario);
  proyectados.sort(porHorario);

  porVerificar.sort(porHorario);
  return { enJuego, terminados, porVerificar, proyectados };
}
