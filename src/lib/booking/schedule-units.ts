/**
 * Una salida de ruta puede llevar varias naves. La primera sigue en `Schedule.vehicleId` (y su chofer
 * en `Schedule.driverId`); las demás están en `ScheduleUnit`. El cupo de la salida es la suma de los
 * asientos de todas sus naves activas.
 *
 * El número de asiento de una reserva es un control interno de cupo (el pasajero no lo elige ni lo
 * ve). Para que dos naves con un asiento "1" no choquen dentro de la misma salida, los asientos de la
 * segunda nave en adelante llevan delante la posición de la nave: "U2-1", "U3-14".
 */

export type UnitSeat = { id: string; vehicleId: string; number: string; row: number; column: number };

type UnitVehicle = { id?: string; isActive?: boolean; seats?: UnitSeat[]; _count?: { seats: number } };

export type ScheduleWithUnits = {
  vehicle: UnitVehicle | null;
  extraUnits?: Array<{ vehicle: UnitVehicle }>;
};

/** Las naves extra, en el orden en que se sumaron. Va en el `include` de cada consulta de salidas. */
export const extraUnitsOrder = { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] };

export const extraUnitsSeatsInclude = { ...extraUnitsOrder, include: { vehicle: { include: { seats: true } } } };

export const extraUnitsCountInclude = {
  ...extraUnitsOrder,
  include: { vehicle: { select: { id: true, isActive: true, name: true, _count: { select: { seats: true } } } } }
};

/** Prefijo del asiento de la nave en la posición `position` (1 es la principal, que no lleva prefijo). */
export function unitSeatPrefix(position: number) {
  return position <= 1 ? "" : `U${position}-`;
}

function seatsOf(vehicle: UnitVehicle | null) {
  return vehicle?.seats ?? [];
}

function countOf(vehicle: UnitVehicle | null) {
  return vehicle?._count?.seats ?? vehicle?.seats?.length ?? 0;
}

/**
 * Todas las naves de la salida en orden: la principal y después las extra. Una nave extra dada de
 * baja no suma lugares (la principal inactiva ya cierra la venta de la salida entera).
 */
export function scheduleVehicles<T>(schedule: { vehicle: T | null; extraUnits?: Array<{ vehicle: T }> }): T[] {
  const extras = (schedule.extraUnits ?? []).map((unit) => unit.vehicle);
  return schedule.vehicle ? [schedule.vehicle, ...extras] : extras;
}

/** Lugares de la salida: la suma de los asientos de sus naves activas. */
export function scheduleSeatCount(schedule: ScheduleWithUnits) {
  return countOf(schedule.vehicle) + (schedule.extraUnits ?? [])
    .filter((unit) => unit.vehicle.isActive !== false)
    .reduce((total, unit) => total + countOf(unit.vehicle), 0);
}

/**
 * Los asientos de todas las naves de la salida como un solo plano, con el número ya único dentro de
 * la salida. `unit` es la posición de la nave (1 la principal) y ordena el plano nave por nave.
 */
export function scheduleSeatPool(schedule: ScheduleWithUnits): Array<UnitSeat & { unit: number }> {
  const pool: Array<UnitSeat & { unit: number }> = seatsOf(schedule.vehicle).map((seat) => ({ ...seat, unit: 1 }));
  (schedule.extraUnits ?? []).forEach((extra, index) => {
    if (extra.vehicle.isActive === false) return;
    const position = index + 2;
    const prefix = unitSeatPrefix(position);
    for (const seat of seatsOf(extra.vehicle)) pool.push({ ...seat, number: `${prefix}${seat.number}`, unit: position });
  });
  return pool;
}
