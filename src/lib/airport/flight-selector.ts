/**
 * Lista de vuelos del selector de reserva (checkout público y alta desde el panel).
 *
 * El pasajero tiene que ver primero los vuelos que puede reservar para el sentido elegido. Los que
 * ya no se pueden reservar (ya llegó / ya salió, cancelado, desviado, sin cupo) no se mezclan con
 * esos: van aparte, con su motivo, para que quien busca un vuelo puntual entienda por qué no está
 * entre los disponibles. El listado del panel (`/admin/aeropuerto`) no usa esto: ahí la operación
 * necesita todos los vuelos del día.
 */
export type VueloDelSelector = {
  direction: "ARRIVAL" | "DEPARTURE";
  bookable: boolean;
};

export function separarVuelosDelSelector<T extends VueloDelSelector>(
  vuelos: readonly T[],
  sentido: VueloDelSelector["direction"]
): { reservables: T[]; noReservables: T[] } {
  const reservables: T[] = [];
  const noReservables: T[] = [];
  for (const vuelo of vuelos) {
    if (vuelo.direction !== sentido) continue;
    (vuelo.bookable ? reservables : noReservables).push(vuelo);
  }
  return { reservables, noReservables };
}
