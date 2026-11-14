/**
 * La hora del vuelo que manda, en un solo lugar (issue #140).
 *
 * El mismo servicio se nombraba con tres horas distintas: el corte de venta corría con la estimada
 * cuando había demora, la orden de servicio y la planilla del chofer con la programada, y el
 * operador puede fijar a mano el inicio de la recorrida. El chofer leía en la hoja una hora que no
 * era la del vuelo real y el pasajero veía una tercera.
 *
 * Criterio único: la estimada cuando la aerolínea la informó, si no la programada. Sirve igual para
 * una demora y para un adelanto —las dos mueven la recorrida—, y es lo que el checkout público ya
 * le muestra al pasajero (`estimatedAt ?? scheduledAt`).
 *
 * Lo que fija el operador a mano (`pickupStartOverrideAt`) no es la hora del vuelo sino el arranque
 * de la recorrida: manda sobre lo derivado y se resuelve en `airportPickupStart`.
 */
export function horaEfectivaDelVuelo(flight: { scheduledAt: Date; estimatedAt?: Date | null }): Date {
  return flight.estimatedAt ?? flight.scheduledAt;
}

/** ¿La hora efectiva se corrió respecto de la programada? Con el minuto alcanza: la hoja no muestra segundos. */
export function corrioElHorario(flight: { scheduledAt: Date; estimatedAt?: Date | null }): boolean {
  return horaEfectivaDelVuelo(flight).getTime() !== flight.scheduledAt.getTime();
}
