import type { SyncSummary } from "./sync";

/**
 * Aviso que ve el operador después de «Actualizar vuelos».
 *
 * Los tres avisos pueden aparecer juntos y en ese orden: un proveedor caído no puede tapar que
 * quedaron vuelos repetidos que hay que resolver a mano (issue #76).
 */
export function mensajeDeRefresco(r: SyncSummary): string {
  const unificados =
    r.jetSmartUnificados > 0 ? ` ${r.jetSmartUnificados} vuelo(s) de JetSMART repetidos se unificaron.` : "";
  const conReservas =
    r.repetidosConReservas.length > 0
      ? ` Quedan repetidos con reservas en las dos filas, revisalos a mano: ${r.repetidosConReservas.join("; ")}.`
      : "";
  const degradado =
    r.errores.length > 0
      ? ` No se pudo traer los vuelos (${r.errores[0]}); se sigue con lo cargado a mano.`
      : "";
  return `Vuelos actualizados: ${r.creados} nuevos, ${r.actualizados} revisados (${r.desdeTablero} desde el tablero del aeropuerto), ${r.eventos} imprevisto(s).${unificados}${conReservas}${degradado}`;
}
