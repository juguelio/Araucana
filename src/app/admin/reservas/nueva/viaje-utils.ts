/**
 * Lógica del viaje de «Nueva reserva» con el template del aeropuerto (pedido de Jugue, 18-nov), sin
 * React para poder testearla: qué lugares y destinos hay, qué salidas tiene un día, qué vuelta se
 * puede ofrecer y cuánto sale.
 */

import { fareCounts, reservationTotalCents } from "@/lib/booking/passenger-fares";
import { claveDeLugar } from "@/lib/booking/place-names";
import type { SalidaOption } from "./salida-picker-utils";

export type Lugar = { nombre: string; salidas: number };

/** Una ruta activa, tenga o no salidas cargadas (para listarla igual en Desde/Hacia). */
export type RutaDelPanel = { id: string; from: string; to: string };

/**
 * Un solo nombre por lugar: «San Martin de los Andes» y «San Martín de los Andes» son el mismo (las
 * rutas del repo lo escriben sin tilde). Se muestra la forma con tildes si existe; si no, la más usada.
 */
export function unificarLugares(salidas: SalidaOption[], rutas: RutaDelPanel[] = []) {
  const variantes = new Map<string, Map<string, number>>();
  for (const nombre of [...salidas.flatMap((s) => [s.from, s.to]), ...rutas.flatMap((r) => [r.from, r.to])]) {
    const clave = claveDeLugar(nombre);
    const formas = variantes.get(clave) ?? new Map<string, number>();
    const limpio = nombre.trim().replace(/\s+/g, " ");
    formas.set(limpio, (formas.get(limpio) ?? 0) + 1);
    variantes.set(clave, formas);
  }
  const nombreDe = new Map<string, string>();
  for (const [clave, formas] of variantes) {
    const elegido = [...formas.entries()].sort(
      (a, b) => Number(/[^\x00-\x7f]/.test(b[0])) - Number(/[^\x00-\x7f]/.test(a[0])) || b[1] - a[1] || a[0].localeCompare(b[0], "es")
    )[0][0];
    nombreDe.set(clave, elegido);
  }
  const nombre = (lugar: string) => nombreDe.get(claveDeLugar(lugar)) ?? lugar;
  return {
    salidas: salidas.map((salida) => ({ ...salida, from: nombre(salida.from), to: nombre(salida.to) })),
    rutas: rutas.map((ruta) => ({ ...ruta, from: nombre(ruta.from), to: nombre(ruta.to) }))
  };
}

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

/** Suma con 0 salidas los lugares de rutas activas que todavía no tienen salidas cargadas. */
function conRutasSinSalidas(lugares: Lugar[], nombres: string[]) {
  const vistos = new Set(lugares.map((lugar) => lugar.nombre));
  const faltan = [...new Set(nombres)].filter((nombre) => !vistos.has(nombre)).sort((a, b) => a.localeCompare(b, "es"));
  return [...lugares, ...faltan.map((nombre) => ({ nombre, salidas: 0 }))];
}

/** Desde dónde se puede salir (las rutas sin salidas cargadas, al final). */
export function origenes(salidas: SalidaOption[], rutas: RutaDelPanel[] = []) {
  return conRutasSinSalidas(contar(salidas.map((salida) => salida.from)), rutas.map((ruta) => ruta.from));
}

/** Adónde se puede ir desde `origen` (las rutas sin salidas cargadas, al final). */
export function destinosDesde(salidas: SalidaOption[], origen: string, rutas: RutaDelPanel[] = []) {
  return conRutasSinSalidas(
    contar(salidas.filter((salida) => salida.from === origen).map((salida) => salida.to)),
    rutas.filter((ruta) => ruta.from === origen).map((ruta) => ruta.to)
  );
}

/** La ruta activa de `desde` a `hacia` (para ofrecer cargarle salidas si no tiene). */
export function rutaEntre(rutas: RutaDelPanel[], desde: string, hacia: string) {
  return rutas.find((ruta) => ruta.from === desde && ruta.to === hacia) ?? null;
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
