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

/**
 * ¿Esta fila ya conocida puede impedir que se cree la de **otro** vuelo que llega del tablero?
 *
 * El sync del tablero no crea una fila si ya hay un vuelo del mismo sentido a ±25 minutos: es el
 * guard contra el mismo servicio reportado con otro código. Un vuelo que no se ofrece no cumple ese
 * papel — es otro servicio, en otra ruta, que el pasajero no ve. Medido el 14-nov (#145): una fila
 * AJ325 a las 14:30 dejaba sin crear el AR1657 de las 14:55 que el aeropuerto sí publica.
 */
export function puedeTaparUnVueloDelTablero(numero: string): boolean {
  return !noSeOfrece(numero);
}
