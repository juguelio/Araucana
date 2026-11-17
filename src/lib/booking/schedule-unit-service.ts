import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordScheduleAudit } from "@/lib/audit/schedule";
import type { AuditActor } from "@/lib/audit/record";
import { conflictKey, fleetConflicts, lockFleet, recordAcceptance, type FleetConflict } from "@/lib/special-trips/conflicts";
import { vehicleConflictNotice } from "./schedule-vehicle";

/**
 * Sumar, cambiar y quitar naves de una salida de ruta. Lo usan «Salidas del día», la ficha de la
 * salida y el calendario de la ruta, así las reglas son las mismas en las tres pantallas:
 *
 * - una nave no se repite en la salida y tiene que estar activa;
 * - una nave con otro servicio en ese horario no se guarda; un posible cruce (aeropuerto, Chapelco)
 *   se muestra y se guarda si se confirma, igual que al elegir la nave principal;
 * - no se quita una nave si con las que quedan no entran los pasajeros que ya reservaron.
 */

export type UnitResult =
  | { ok: true; summary: string; schedule: { id: string; routeId: string; departureAt: Date; slug: string | null } }
  | { ok?: false; error: string }
  | { ok?: false; conflicts: FleetConflict[]; confirmation: string };

const ACTIVE = { not: "CANCELLED" } as const;

const scheduleForUnits = {
  id: true, routeId: true, vehicleId: true, driverId: true, departureAt: true, arrivalAt: true, status: true,
  route: { select: { slug: true } },
  vehicle: { select: { _count: { select: { seats: true } } } },
  extraUnits: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    select: { id: true, vehicleId: true, driverId: true, vehicle: { select: { isActive: true, _count: { select: { seats: true } } } } }
  },
  reservations: { where: { status: ACTIVE }, select: { passengerCount: true } }
} satisfies Prisma.ScheduleSelect;

type LoadedSchedule = Prisma.ScheduleGetPayload<{ select: typeof scheduleForUnits }>;

function auditRow(schedule: Pick<LoadedSchedule, "id" | "routeId" | "vehicleId" | "driverId" | "departureAt" | "arrivalAt" | "status">, extraUnits: Array<{ vehicleId: string; driverId: string | null }>) {
  const { id, routeId, vehicleId, driverId, departureAt, arrivalAt, status } = schedule;
  return { id, routeId, vehicleId, driverId, departureAt, arrivalAt, status, extraUnits: extraUnits.map(({ vehicleId: v, driverId: d }) => ({ vehicleId: v, driverId: d })) };
}

function done(schedule: LoadedSchedule, summary: string): UnitResult {
  return { ok: true, summary, schedule: { id: schedule.id, routeId: schedule.routeId, departureAt: schedule.departureAt, slug: schedule.route.slug } };
}

function occupied(schedule: LoadedSchedule) {
  return schedule.reservations.reduce((total, reservation) => total + reservation.passengerCount, 0);
}

async function activeDriver(driverId: string) {
  return prisma.user.findFirst({ where: { id: driverId, role: "DRIVER", isActive: true }, select: { id: true } });
}

async function checkVehicle(
  tx: Prisma.TransactionClient, schedule: LoadedSchedule, vehicleId: string, confirmationSent: string, proposal: unknown
): Promise<{ stop: UnitResult } | { conflicts: FleetConflict[] }> {
  await lockFleet(tx, [vehicleId]);
  const conflicts = await fleetConflicts(tx, { vehicleId, startsAt: schedule.departureAt, endsAt: schedule.arrivalAt }, undefined, schedule.id);
  if (conflicts.some((conflict) => !conflict.possible)) return { stop: { error: vehicleConflictNotice(conflicts.filter((conflict) => !conflict.possible)) } };
  const confirmation = conflictKey(conflicts, proposal);
  if (conflicts.length && confirmationSent !== confirmation) return { stop: { conflicts, confirmation } };
  return { conflicts };
}

async function validateInputs(vehicleId: string, driverId: string | null) {
  if (!vehicleId) return "Elegí la nave.";
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { isActive: true } });
  if (!vehicle?.isActive) return "Esa nave no está disponible: elegí una unidad activa.";
  if (driverId && !(await activeDriver(driverId))) return "Ese chofer no está disponible: elegí un chofer activo.";
  return null;
}

/** Suma una nave (con su chofer, opcional) a una salida. */
export async function addScheduleUnit(input: {
  actor: AuditActor & { id: string };
  scheduleId: string;
  vehicleId: string;
  driverId: string | null;
  confirmation: string;
}): Promise<UnitResult> {
  const invalid = await validateInputs(input.vehicleId, input.driverId);
  if (invalid) return { error: invalid };
  return prisma.$transaction(async (tx) => {
    const schedule = await tx.schedule.findUnique({ where: { id: input.scheduleId }, select: scheduleForUnits });
    if (!schedule) return { error: "La salida ya no existe." };
    if (schedule.vehicleId === input.vehicleId || schedule.extraUnits.some((unit) => unit.vehicleId === input.vehicleId)) {
      return { error: "Esa nave ya está en la salida." };
    }
    const check = await checkVehicle(tx, schedule, input.vehicleId, input.confirmation, ["add", schedule.id, input.vehicleId]);
    if ("stop" in check) return check.stop;
    await tx.scheduleUnit.create({ data: { scheduleId: schedule.id, vehicleId: input.vehicleId, driverId: input.driverId } });
    await recordAcceptance(tx, "PUBLIC", schedule.id, input.actor.id, check.conflicts);
    await recordScheduleAudit(tx, input.actor, "Nave sumada a la salida.",
      auditRow(schedule, schedule.extraUnits),
      auditRow(schedule, [...schedule.extraUnits, { vehicleId: input.vehicleId, driverId: input.driverId }]));
    return done(schedule, "Nave sumada a la salida.");
  });
}

/** Cambia la nave o el chofer de una nave extra de la salida. */
export async function updateScheduleUnit(input: {
  actor: AuditActor & { id: string };
  unitId: string;
  vehicleId: string;
  driverId: string | null;
  confirmation: string;
}): Promise<UnitResult> {
  const unit = await prisma.scheduleUnit.findUnique({ where: { id: input.unitId }, select: { scheduleId: true, vehicleId: true, driverId: true } });
  if (!unit) return { error: "Esa nave ya no está en la salida." };
  const vehicleChanged = unit.vehicleId !== input.vehicleId;
  const driverChanged = unit.driverId !== input.driverId;
  if (!vehicleChanged && !driverChanged) return { error: "La nave ya tenía ese chofer." };
  if (vehicleChanged) {
    const invalid = await validateInputs(input.vehicleId, null);
    if (invalid) return { error: invalid };
  }
  if (driverChanged && input.driverId && !(await activeDriver(input.driverId))) {
    return { error: "Ese chofer no está disponible: elegí un chofer activo." };
  }
  return prisma.$transaction(async (tx) => {
    const schedule = await tx.schedule.findUnique({ where: { id: unit.scheduleId }, select: scheduleForUnits });
    if (!schedule) return { error: "La salida ya no existe." };
    let conflicts: FleetConflict[] = [];
    if (vehicleChanged) {
      if (schedule.vehicleId === input.vehicleId || schedule.extraUnits.some((other) => other.id !== input.unitId && other.vehicleId === input.vehicleId)) {
        return { error: "Esa nave ya está en la salida." };
      }
      const seatsNow = schedule.extraUnits.find((other) => other.id === input.unitId)?.vehicle._count.seats ?? 0;
      const replacement = await tx.vehicle.findUnique({ where: { id: input.vehicleId }, select: { _count: { select: { seats: true } } } });
      const capacity = totalSeats(schedule) - seatsNow + (replacement?._count.seats ?? 0);
      if (occupied(schedule) > capacity) {
        return { error: `Con esa nave no entran los ${occupied(schedule)} pasajeros reservados (quedarían ${capacity} lugares).` };
      }
      const check = await checkVehicle(tx, schedule, input.vehicleId, input.confirmation, ["unit", input.unitId, input.vehicleId]);
      if ("stop" in check) return check.stop;
      conflicts = check.conflicts;
    }
    await tx.scheduleUnit.update({ where: { id: input.unitId }, data: { vehicleId: input.vehicleId, driverId: input.driverId } });
    await recordAcceptance(tx, "PUBLIC", schedule.id, input.actor.id, conflicts);
    const after = schedule.extraUnits.map((other) => other.id === input.unitId ? { vehicleId: input.vehicleId, driverId: input.driverId } : other);
    const summary = vehicleChanged && driverChanged ? "Nave y chofer de una nave de la salida cambiados."
      : vehicleChanged ? "Nave de la salida cambiada." : input.driverId ? "Chofer asignado a una nave de la salida." : "Chofer quitado de una nave de la salida.";
    await recordScheduleAudit(tx, input.actor, summary, auditRow(schedule, schedule.extraUnits), auditRow(schedule, after));
    return done(schedule, summary);
  });
}

function totalSeats(schedule: LoadedSchedule) {
  return schedule.vehicle._count.seats + schedule.extraUnits
    .filter((unit) => unit.vehicle.isActive)
    .reduce((total, unit) => total + unit.vehicle._count.seats, 0);
}

/**
 * Quita una nave de la salida. `unitId` es una nave extra; con `primaryOf` se quita la principal y la
 * primera nave extra pasa a ser la principal (con su chofer). Una salida no se queda sin naves: para
 * eso se cierra o se borra la salida.
 */
export async function removeScheduleUnit(input: {
  actor: AuditActor & { id: string };
  unitId?: string;
  primaryOf?: string;
}): Promise<UnitResult> {
  return prisma.$transaction(async (tx) => {
    const scheduleId = input.primaryOf
      ?? (input.unitId ? (await tx.scheduleUnit.findUnique({ where: { id: input.unitId }, select: { scheduleId: true } }))?.scheduleId : undefined);
    if (!scheduleId) return { error: "Esa nave ya no está en la salida." };
    const schedule = await tx.schedule.findUnique({ where: { id: scheduleId }, select: scheduleForUnits });
    if (!schedule) return { error: "La salida ya no existe." };
    const leaving = input.unitId && !input.primaryOf ? schedule.extraUnits.find((unit) => unit.id === input.unitId) : null;
    if (input.primaryOf && !schedule.extraUnits.length) {
      return { error: "Es la única nave de la salida: para sacarla, cerrá o borrá la salida." };
    }
    if (!input.primaryOf && !leaving) return { error: "Esa nave ya no está en la salida." };
    const seatsLeaving = leaving ? (leaving.vehicle.isActive ? leaving.vehicle._count.seats : 0) : schedule.vehicle._count.seats;
    const capacity = totalSeats(schedule) - seatsLeaving;
    if (occupied(schedule) > capacity) {
      return { error: `No se quitó: con las naves que quedan no entran los ${occupied(schedule)} pasajeros reservados (quedarían ${capacity} lugares).` };
    }
    let after;
    if (input.primaryOf) {
      const [promoted, ...rest] = schedule.extraUnits;
      await tx.scheduleUnit.delete({ where: { id: promoted.id } });
      await tx.schedule.update({ where: { id: schedule.id }, data: { vehicleId: promoted.vehicleId, driverId: promoted.driverId } });
      after = auditRow({ ...schedule, vehicleId: promoted.vehicleId, driverId: promoted.driverId }, rest);
    } else {
      await tx.scheduleUnit.delete({ where: { id: leaving!.id } });
      after = auditRow(schedule, schedule.extraUnits.filter((unit) => unit.id !== leaving!.id));
    }
    await recordScheduleAudit(tx, input.actor, "Nave quitada de la salida.", auditRow(schedule, schedule.extraUnits), after);
    return done(schedule, "Nave quitada de la salida.");
  });
}

/**
 * Al cambiar la nave principal de una salida: que no sea una de las naves ya sumadas y que con la
 * nueva entren los pasajeros reservados. Devuelve el aviso, o `null` si se puede.
 */
export async function primaryVehicleProblem(tx: Prisma.TransactionClient, scheduleId: string, vehicleId: string) {
  const schedule = await tx.schedule.findUnique({ where: { id: scheduleId }, select: scheduleForUnits });
  if (!schedule || schedule.vehicleId === vehicleId) return null;
  if (schedule.extraUnits.some((unit) => unit.vehicleId === vehicleId)) return "Esa nave ya está sumada a la salida: quitala de las otras naves o elegí otra.";
  const replacement = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { _count: { select: { seats: true } } } });
  const capacity = totalSeats(schedule) - schedule.vehicle._count.seats + (replacement?._count.seats ?? 0);
  const taken = occupied(schedule);
  return taken > capacity ? `Con esa nave no entran los ${taken} pasajeros reservados (quedarían ${capacity} lugares).` : null;
}
