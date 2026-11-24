import { dayInterval } from "./conflicts";
import { dateOnly, localInput } from "./data";

/**
 * Lo que la vista «Día» del panel muestra de un viaje especial (issue #443).
 *
 * `serviceDate`/`endDate` son DATE guardados a las 00:00Z y se comparan en UTC (`rango.ts`), pero las
 * asignaciones de nave son instantes: su día es el argentino, de 00:00 a 24:00 ART —la misma ventana que
 * usa el calendario semanal (`dayInterval`)—. Con medianoche UTC la ventana quedaba corrida tres horas y
 * un servicio de 22:30 ART caía fuera de su propio día: la tabla mostraba «Sin nave» para un viaje que
 * ese día sí tenía nave, y el de las 22:00 del día anterior aparecía en el día siguiente.
 */

type Asignacion = { startsAt: Date; endsAt: Date; vehicle: { name: string } };

/** Asignaciones que tocan el día argentino `clave`: empiezan antes de las 24:00 ART y terminan después de las 00:00. */
export function asignacionesDelDia<T extends Asignacion>(assignments: T[], clave: string): T[] {
  const { startsAt, endsAt } = dayInterval(clave);
  return assignments.filter((assignment) => assignment.startsAt < endsAt && assignment.endsAt > startsAt);
}

/** Naves distintas que cubren el día, en el orden en que entran; vacío deja la tabla mostrando «Sin nave». */
export function navesDelDia(assignments: Asignacion[], clave: string): string[] {
  return [...new Set(asignacionesDelDia(assignments, clave).map(({ vehicle }) => vehicle.name))];
}

/** La salida del día —la primera asignación que empieza ese día argentino—, o `null` si ese día no arranca ninguna. */
export function salidaDelDia<T extends Asignacion>(assignments: T[], clave: string): T | null {
  const { startsAt, endsAt } = dayInterval(clave);
  return assignments.find((assignment) => assignment.startsAt >= startsAt && assignment.startsAt < endsAt) ?? null;
}

/**
 * Fecha con la que abre el alta de un viaje especial: la del día que el operador estaba mirando
 * (`/nuevo?fecha=YYYY-MM-DD`), o hoy en hora argentina. Cualquier otro valor cae a hoy.
 */
export function fechaInicialDeAlta(raw: string | string[] | undefined, ahora: Date): string {
  return (typeof raw === "string" && dateOnly(raw) ? raw : null) ?? localInput(ahora).slice(0, 10);
}
