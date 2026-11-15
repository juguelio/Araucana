/**
 * Vuelos que el sistema conoce pero **no se ofrecen al pasajero**.
 *
 * Pedido del cliente (14-nov): «saca los vuelos a NQN por ahora». Son los American Jet entre
 * Neuquén y Chapelco: AJ324/325 (cargados a mano) y AJ328/329 (vistos en el tablero en octubre).
 * No se borran de la base porque el dato del aeropuerto es real; simplemente no se listan —ni en la
 * reserva ni en el panel del día— y no se proyectan a futuro, así no se pueden reservar.
 *
 * Volver a ofrecerlos es borrar el número de esta lista: no hay nada más que tocar.
 */
export const VUELOS_QUE_NO_SE_OFRECEN = new Set(["AJ324", "AJ325", "AJ328", "AJ329"]);

/** `true` si el vuelo está en la lista de «conocido pero no se ofrece». */
export function noSeOfrece(numero: string): boolean {
  return VUELOS_QUE_NO_SE_OFRECEN.has(numero.trim().toUpperCase());
}
