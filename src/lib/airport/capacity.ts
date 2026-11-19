/**
 * Capacidad de una unidad desde el punto de vista del aeropuerto.
 *
 * Vive en su propio módulo —y no en `booking.ts`— porque `booking.ts` importa Prisma y el editor
 * del plano de butacas (`seat-layout-editor.tsx`) es un componente cliente: necesita el mismo
 * cálculo para mostrar en vivo cuántas butacas vende la unidad, sin arrastrar el cliente de la base
 * al bundle del navegador. `booking.ts` re-exporta estas piezas, así que la regla sigue siendo una.
 */

/** Las unidades con menos butacas que esto pierden `BUTACAS_PARA_EQUIPAJE` en el aeropuerto. */
export const UNIDAD_GRANDE_DESDE = 26;
/** Butacas que una unidad chica deja libres para el equipaje en los traslados al aeropuerto. */
export const BUTACAS_PARA_EQUIPAJE = 4;

/**
 * Butacas que una nave vende para el aeropuerto. Una unidad de menos de 26 butacas pierde 4 para el
 * equipaje, pedido del cliente (17/11/2026). Los buses grandes tienen bodega y venden todas. Con 0
 * butacas no hay plano cargado y no se sabe la capacidad: queda en 0.
 */
export function butacasParaAeropuerto(seats: number): number {
  if (seats <= 0) return 0;
  return seats < UNIDAD_GRANDE_DESDE ? Math.max(seats - BUTACAS_PARA_EQUIPAJE, 0) : seats;
}

/** ¿La unidad tiene plano de butacas? Con 0 no hay capacidad, y «0 pasajeros» se lee como dato válido. */
export function tienePlanoDeButacas(asientos: number): boolean {
  return asientos > 0;
}

/**
 * Texto de la columna «Capacidad» del listado de naves. Una unidad sin plano no dice «0 pasajeros»:
 * dice que falta cargar la capacidad, que es lo que el operador tiene que hacer.
 */
export function etiquetaCapacidad(asientos: number): string {
  if (!tienePlanoDeButacas(asientos)) return "Falta cargar la capacidad";
  return `${asientos} ${asientos === 1 ? "pasajero" : "pasajeros"}`;
}

/** Resumen para el encabezado del editor del plano: qué ve el operador mientras dibuja las butacas. */
export function resumenButacas(asientos: number): string {
  if (!tienePlanoDeButacas(asientos)) return "Sin butacas cargadas";
  const aeropuerto = butacasParaAeropuerto(asientos);
  const equipaje = asientos - aeropuerto;
  const detalle = equipaje > 0 ? `${equipaje} para equipaje` : "todas para pasajeros";
  return `${asientos} ${asientos === 1 ? "butaca" : "butacas"} · ${aeropuerto} para aeropuerto · ${detalle}`;
}
