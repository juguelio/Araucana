/**
 * Lógica del viaje de «Nueva reserva» con el template del aeropuerto (pedido de Jugue, 18-nov), sin
 * React para poder testearla: qué lugares y destinos hay, qué salidas tiene un día, qué vuelta se
 * puede ofrecer y cuánto sale.
 */

import { fareCounts, reservationTotalCents } from "@/lib/booking/passenger-fares";
import type { SalidaOption } from "./salida-picker-utils";

export type Lugar = { nombre: string; salidas: number };

/** Clave para ordenar y comparar salidas en el tiempo: el día y la hora de Argentina. */
export function momento(salida: Pick<SalidaOption, "dayKey" | "timeLabel">) {
  return `${salida.dayKey} ${salida.timeLabel}`;
}

function contar(nombres: string[]): Lugar[] {
  const mapa = new Map<string, number>();
  for (const nombre of nombres) mapa.set(nombre, (mapa.get(nombre) ?? 0) + 1);
  // Primero los lugares con más salidas (los que más se usan), después por nombre.
  return [...mapa.entries()]
    .map(([nombre, salidas]) => ({ nombre, salidas }))
    .sort((a, b) => b.salidas - a.salidas || a.nombre.localeCompare(b.nombre, "es"));
}

/** Desde dónde se puede salir. */
export function origenes(salidas: SalidaOption[]) {
  return contar(salidas.map((salida) => salida.from));
}

/** Adónde se puede ir desde `origen`. */
export function destinosDesde(salidas: SalidaOption[], origen: string) {
  return contar(salidas.filter((salida) => salida.from === origen).map((salida) => salida.to));
}

/** Las salidas de un tramo, en orden. */
export function salidasDelTramo(salidas: SalidaOption[], desde: string, hacia: string) {
  return salidas
    .filter((salida) => salida.from === desde && salida.to === hacia)
    .sort((a, b) => momento(a).localeCompare(momento(b)));
}

/** Cuántas salidas tiene cada día (para la tira de días). */
export function conteoPorDia(salidas: SalidaOption[]) {
  const mapa = new Map<string, number>();
  for (const salida of salidas) mapa.set(salida.dayKey, (mapa.get(salida.dayKey) ?? 0) + 1);
  return mapa;
}

/**
 * Las salidas de la vuelta que sirven: la ruta inversa, después de la ida. Sin ida elegida, todas las
 * de la ruta inversa (se puede mirar antes de elegir).
 */
export function vueltasPosibles(salidas: SalidaOption[], origen: string, destino: string, ida?: SalidaOption | null) {
  const inversa = salidasDelTramo(salidas, destino, origen);
  return ida ? inversa.filter((salida) => momento(salida) > momento(ida)) : inversa;
}

/** El primer día con salidas desde `minimo` (o el primero de todos). */
export function primerDia(salidas: SalidaOption[], minimo = "") {
  return salidas.find((salida) => salida.dayKey >= minimo)?.dayKey ?? "";
}

/** Precio por persona de un tramo: el de la parada donde baja, o el de la salida. */
export function precioDelTramo(salida: SalidaOption, parada: string) {
  const tarifa = parada ? salida.stopFares?.find((fare) => fare.name === parada) : undefined;
  return tarifa?.priceCents ?? salida.priceCents ?? 0;
}

/** Total estimado del viaje (ida, y vuelta si hay), con los menores. */
export function totalDelViaje(
  tramos: Array<{ salida: SalidaOption; parada: string }>,
  pasajeros: { lugares: number; media: number; sinCargo: number }
) {
  const cuentas = fareCounts(pasajeros.lugares, pasajeros.media, pasajeros.sinCargo);
  return tramos.reduce((total, tramo) => total + reservationTotalCents(precioDelTramo(tramo.salida, tramo.parada), cuentas), 0);
}

/** El viaje que se propone al abrir: el origen y el destino con más salidas, y su primer día. */
export function viajeInicial(salidas: SalidaOption[]) {
  const origen = origenes(salidas)[0]?.nombre ?? "";
  const destino = destinosDesde(salidas, origen)[0]?.nombre ?? "";
  return { origen, destino, dia: primerDia(salidasDelTramo(salidas, origen, destino)) };
}
