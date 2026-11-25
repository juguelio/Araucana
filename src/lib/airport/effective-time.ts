/** Hora de despegue o aterrizaje informada por la aerolínea. */
export function horaEfectivaDelVuelo(flight: { scheduledAt: Date; estimatedAt?: Date | null }): Date {
  return flight.estimatedAt ?? flight.scheduledAt;
}

/** ¿La hora efectiva se corrió respecto de la programada? Con el minuto alcanza: la hoja no muestra segundos. */
export function corrioElHorario(flight: { scheduledAt: Date; estimatedAt?: Date | null }): boolean {
  return horaEfectivaDelVuelo(flight).getTime() !== flight.scheduledAt.getTime();
}
