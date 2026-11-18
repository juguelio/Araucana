"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminOrRedirect, getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { recordScheduleAudit } from "@/lib/audit/schedule";
import { recordEntityAuditAfterCommit } from "@/lib/audit/entity";
import { vehicleConflictNotice } from "@/lib/booking/schedule-vehicle";
import { conflictKey, fleetConflicts, lockFleet, recordAcceptance, type FleetConflict } from "@/lib/special-trips/conflicts";
import type { Prisma } from "@prisma/client";
import { isDateKey, localDateKey } from "@/lib/operations/day-board";
import { redirectToBoard } from "./return-to";
import { replaceRouteVehicle } from "@/lib/booking/replace-route-vehicle";
import { addScheduleUnit, primaryVehicleProblem, removeScheduleUnit, updateScheduleUnit, type UnitResult } from "@/lib/booking/schedule-unit-service";

export type CrewState = { error?: string; conflicts?: FleetConflict[]; confirmation?: string };

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function personLabel(person: { name: string | null; email: string } | null | undefined) {
  return person ? person.name ?? person.email : null;
}

/** Sólo se asignan choferes: usuarios activos con rol de chofer (los de /admin/choferes). */
async function activeDriver(driverId: string) {
  return prisma.user.findFirst({ where: { id: driverId, role: "DRIVER", isActive: true }, select: { id: true, name: true, email: true } });
}

/**
 * En el tablero, un choque seguro (otra salida o un viaje especial en ese horario) no se guarda; un
 * posible cruce (aeropuerto y Chapelco, que se cuentan por día completo porque no se sabe cuánto dura
 * el traslado) se muestra y se guarda si se confirma. Antes, la combi del vuelo de las 08:30 no se
 * podía usar en ninguna salida de ruta en todo el día.
 */
function checkConflicts(conflicts: FleetConflict[], proposal: unknown, confirmationSent: string): CrewState | null {
  if (conflicts.some((conflict) => !conflict.possible)) return { error: "hard" };
  const confirmation = conflictKey(conflicts, proposal);
  if (conflicts.length && confirmationSent !== confirmation) return { conflicts, confirmation };
  return null;
}

function boardDate(formData: FormData, fallback: Date) {
  const date = value(formData, "date");
  return isDateKey(date) ? date : localDateKey(fallback);
}

/**
 * Nave y chofer de una salida de ruta, en un solo paso (issue #174). La nave se valida igual que el
 * cambio rápido del calendario (#81): unidad activa y sin otro servicio en ese horario. El chofer es
 * nuevo: antes las salidas de ruta no tenían.
 */
export async function saveScheduleCrewAction(_state: CrewState, formData: FormData): Promise<CrewState> {
  const actor = await getCurrentAdminOrRedirect();
  const id = value(formData, "id");
  const vehicleId = value(formData, "vehicleId");
  const driverId = value(formData, "driverId") || null;
  if (value(formData, "kind") === "EXTRA") {
    if (!vehicleId) return { error: "Elegí la nave." };
    const result = await updateScheduleUnit({ actor, unitId: id, vehicleId, driverId, confirmation: value(formData, "confirmation") });
    return afterUnitChange(result, formData);
  }

  const current = id
    ? await prisma.schedule.findUnique({
      where: { id },
      select: { id: true, routeId: true, vehicleId: true, driverId: true, departureAt: true, arrivalAt: true, status: true, route: { select: { slug: true } } }
    })
    : null;
  if (!current) return { error: "La salida ya no existe." };
  const dateKey = boardDate(formData, current.departureAt);
  if (!vehicleId) return { error: "Elegí la nave de la salida." };

  const vehicleChanged = vehicleId !== current.vehicleId;
  const driverChanged = driverId !== current.driverId;
  if (!vehicleChanged && !driverChanged) redirectToBoard(dateKey, "La salida ya tenía esa nave y ese chofer.", formData);

  if (driverId && driverChanged && !(await activeDriver(driverId))) {
    return { error: "Ese chofer no está disponible: elegí un chofer activo." };
  }
  if (vehicleChanged) {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { isActive: true } });
    if (!vehicle?.isActive) return { error: "Esa nave no está disponible: elegí una unidad activa." };
  }

  const result = await prisma.$transaction(async (tx) => {
    let conflicts: FleetConflict[] = [];
    if (vehicleChanged) {
      await lockFleet(tx, [vehicleId]);
      conflicts = await fleetConflicts(tx, { vehicleId, startsAt: current.departureAt, endsAt: current.arrivalAt }, undefined, current.id);
      const check = checkConflicts(conflicts, [current.id, vehicleId], value(formData, "confirmation"));
      if (check) return check.error ? { error: vehicleConflictNotice(conflicts.filter((c) => !c.possible)) } : check;
      const problem = await primaryVehicleProblem(tx, current.id, vehicleId);
      if (problem) return { error: problem };
    }
    const before = await tx.schedule.findUnique({ where: { id: current.id } });
    const updated = await tx.schedule.update({ where: { id: current.id }, data: { vehicleId, driverId } });
    await recordAcceptance(tx, "PUBLIC", current.id, actor.id, conflicts);
    const summary = vehicleChanged && driverChanged
      ? "Nave y chofer de la salida cambiados."
      : vehicleChanged ? "Nave de la salida cambiada." : driverId ? "Chofer de la salida asignado." : "Chofer de la salida quitado.";
    await recordScheduleAudit(tx, actor, summary, before, updated);
    return { summary };
  });
  if (!("summary" in result)) return result;

  revalidatePath("/admin/salidas-del-dia");
  revalidatePath(`/admin/rutas/${current.routeId}/salidas`);
  revalidatePath(`/admin/rutas/${current.routeId}/salidas/${current.id}`);
  if (vehicleChanged && current.route.slug) {
    revalidatePath(`/rutas/${current.route.slug}`);
    revalidatePath(`/reservar/${current.route.slug}`);
  }
  redirectToBoard(dateKey, vehicleChanged ? "Salida actualizada." : driverId ? "Chofer asignado a la salida." : "Chofer quitado de la salida.", formData);
}

/** Chofer de una nave del día de Chapelco. Agregar o quitar la nave sigue en las acciones de Chapelco. */
export async function setChapelcoDriverAction(formData: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const id = value(formData, "id");
  const driverId = value(formData, "driverId") || null;
  const duty = await prisma.chapelcoVehicleDuty.findUnique({
    where: { id },
    select: { driverId: true, operationDayId: true, operationDay: { select: { serviceDate: true } }, vehicle: { select: { name: true } }, driver: { select: { name: true, email: true } } }
  });
  const fallbackDate = boardDate(formData, new Date());
  if (!duty) redirectToBoard(fallbackDate, "Esa nave ya no está en la operación de Chapelco.", formData);
  const day = duty.operationDay.serviceDate.toISOString().slice(0, 10);
  if (duty.driverId === driverId) redirectToBoard(day, "La nave ya tenía ese chofer.", formData);
  const driver = driverId ? await activeDriver(driverId) : null;
  if (driverId && !driver) redirectToBoard(day, "Ese chofer no está disponible: elegí un chofer activo.", formData);

  await prisma.chapelcoVehicleDuty.update({ where: { id }, data: { driverId } });
  await recordEntityAuditAfterCommit(prisma, {
    actor, entity: "CHAPELCO", entityId: duty.operationDayId, entityLabel: `Operación del ${day}`,
    action: "UPDATE",
    summary: `Chofer de la nave ${duty.vehicle.name} cambiado en la operación de Chapelco.`,
    before: { driver: personLabel(duty.driver) },
    after: { driver: personLabel(driver) }
  });
  revalidatePath("/admin/chapelco");
  revalidatePath("/admin/salidas-del-dia");
  redirectToBoard(day, driverId ? "Chofer asignado a la nave." : "Chofer quitado de la nave.", formData);
}

// ── Más flexibilidad desde el tablero (pedido de Jugue, 16-nov): crear salidas, sumar unidades y
//    asignar naves y choferes de los viajes especiales sin salir de «Salidas del día». ──────────────

export type BoardFormState = { error?: string; conflicts?: FleetConflict[]; confirmation?: string };

function timeOnDay(dateKey: string, hhmm: string) {
  if (!isDateKey(dateKey) || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const date = new Date(`${dateKey}T${hhmm}:00-03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Salida nueva de una ruta para el día del tablero, con nave y chofer. También es «sumar otra
 * unidad»: en el sistema cada unidad de una ruta es su propia salida (con sus asientos a la venta),
 * así que dos combis a las 08:00 son dos salidas a las 08:00. La llegada sale de la duración de la
 * ruta. La nave se controla contra todo lo que ya tiene ese horario, igual que el calendario.
 */
export async function createBoardScheduleAction(_state: BoardFormState, formData: FormData): Promise<BoardFormState> {
  const actor = await getCurrentAdminOrRedirect();
  const dateKey = value(formData, "date");
  const routeId = value(formData, "routeId");
  const vehicleId = value(formData, "vehicleId");
  const driverId = value(formData, "driverId") || null;
  const departureAt = timeOnDay(dateKey, value(formData, "time"));
  if (!routeId) return { error: "Elegí la ruta." };
  if (!departureAt) return { error: "Poné la hora de salida." };
  if (!vehicleId) return { error: "Elegí la nave." };

  const [route, vehicle] = await Promise.all([
    prisma.travelRoute.findUnique({ where: { id: routeId }, select: { id: true, slug: true, durationMin: true, bookingMode: true, isActive: true } }),
    prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { isActive: true } })
  ]);
  if (!route || ["AIRPORT", "CHAPELCO"].includes(route.bookingMode)) return { error: "Esa ruta no tiene salidas propias: elegí otra." };
  if (!vehicle?.isActive) return { error: "Esa nave no está disponible: elegí una unidad activa." };
  if (driverId && !(await activeDriver(driverId))) return { error: "Ese chofer no está disponible: elegí un chofer activo." };
  const arrivalAt = new Date(departureAt.getTime() + Math.max(route.durationMin, 1) * 60000);

  // Si la ruta ya tiene una salida a esa hora, la nave se suma a esa salida en vez de crear otra:
  // una salida puede llevar varias naves y el cupo es la suma de todas.
  const existing = await prisma.schedule.findFirst({
    where: { routeId, departureAt, status: { notIn: ["CLOSED", "CANCELLED"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  if (existing) {
    const added = await addScheduleUnit({ actor, scheduleId: existing.id, vehicleId, driverId, confirmation: value(formData, "confirmation") });
    return afterUnitChange(added, formData);
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockFleet(tx, [vehicleId]);
    const conflicts = await fleetConflicts(tx, { vehicleId, startsAt: departureAt, endsAt: arrivalAt });
    const check = checkConflicts(conflicts, [routeId, vehicleId, departureAt.toISOString()], value(formData, "confirmation"));
    if (check?.error) {
      const labels = [...new Set(conflicts.filter((c) => !c.possible).map((c) => c.label))];
      return { error: `No se creó la salida: la nave ya está tomada en ese horario (${labels.join("; ")}).` };
    }
    if (check) return check;
    const created = await tx.schedule.create({ data: { routeId, vehicleId, driverId, departureAt, arrivalAt, status: "OPEN" } });
    await recordAcceptance(tx, "PUBLIC", created.id, actor.id, conflicts);
    await recordScheduleAudit(tx, actor, "Salida creada desde Salidas del día.", null, created);
    return { id: created.id };
  });
  if (!("id" in result)) return result;

  revalidatePath("/admin/salidas-del-dia");
  revalidatePath(`/admin/rutas/${routeId}/salidas`);
  revalidatePath(`/rutas/${route.slug}`);
  revalidatePath(`/reservar/${route.slug}`);
  redirectToBoard(dateKey, route.isActive ? "Salida creada." : "Salida creada. Ojo: la ruta está inactiva y no se vende en la web.", formData);
}

/**
 * Lo que queda después de sumar, cambiar o quitar una nave de una salida: el aviso del choque o del
 * error, o volver al tablero con las pantallas de la salida y de la venta refrescadas (el cupo cambió).
 */
function afterUnitChange(result: UnitResult, formData: FormData): CrewState {
  if (!result.ok) return result;
  const { schedule, summary } = result;
  revalidatePath("/admin/salidas-del-dia");
  revalidatePath(`/admin/rutas/${schedule.routeId}/salidas`);
  revalidatePath(`/admin/rutas/${schedule.routeId}/salidas/${schedule.id}`);
  if (schedule.slug) {
    revalidatePath(`/rutas/${schedule.slug}`);
    revalidatePath(`/reservar/${schedule.slug}`);
  }
  redirectToBoard(boardDate(formData, schedule.departureAt), summary, formData);
}

/** Sumar otra nave (con su chofer) a una salida: el cupo pasa a ser la suma de los asientos. */
export async function addBoardUnitAction(_state: BoardFormState, formData: FormData): Promise<BoardFormState> {
  const actor = await getCurrentAdminOrRedirect();
  const vehicleId = value(formData, "vehicleId");
  if (!vehicleId) return { error: "Elegí la nave." };
  const result = await addScheduleUnit({
    actor, scheduleId: value(formData, "scheduleId"), vehicleId,
    driverId: value(formData, "driverId") || null, confirmation: value(formData, "confirmation")
  });
  return afterUnitChange(result, formData);
}

/**
 * Quitar una nave de una salida. Si la salida tiene otras naves, se saca sólo esa (con la principal,
 * la siguiente pasa a su lugar), siempre que con las que quedan entren los pasajeros. Si es la única
 * nave, se borra la salida, y eso sólo si no tiene reservas (si tiene, se cierra desde la salida).
 */
export async function removeBoardScheduleAction(formData: FormData) {
  const actor = await getCurrentAdminOrRedirect();
  const id = value(formData, "id");
  if (value(formData, "kind") === "EXTRA") {
    const result = await removeScheduleUnit({ actor, unitId: id });
    if (!result.ok) redirectToBoard(boardDate(formData, new Date()), "error" in result ? result.error : "No se pudo quitar la nave.", formData);
    afterUnitChange(result, formData);
    return;
  }
  if (await prisma.scheduleUnit.count({ where: { scheduleId: id } })) {
    const result = await removeScheduleUnit({ actor, primaryOf: id });
    if (!result.ok) redirectToBoard(boardDate(formData, new Date()), "error" in result ? result.error : "No se pudo quitar la nave.", formData);
    afterUnitChange(result, formData);
    return;
  }
  const schedule = await prisma.schedule.findUnique({ where: { id }, select: { id: true, routeId: true, departureAt: true, route: { select: { slug: true } }, _count: { select: { reservations: true } } } });
  const fallback = boardDate(formData, new Date());
  if (!schedule) redirectToBoard(fallback, "Esa salida ya no existe.", formData);
  const dateKey = boardDate(formData, schedule.departureAt);
  if (schedule._count.reservations > 0) redirectToBoard(dateKey, "Esa salida tiene reservas: no se quita desde acá. Cerrala o pasá las reservas desde la salida.", formData);
  await prisma.$transaction(async (tx) => {
    const before = await tx.schedule.findUnique({ where: { id } });
    await recordScheduleAudit(tx, actor, "Salida quitada desde Salidas del día.", before, null);
    await tx.schedule.delete({ where: { id } });
  });
  revalidatePath("/admin/salidas-del-dia");
  revalidatePath(`/admin/rutas/${schedule.routeId}/salidas`);
  revalidatePath(`/rutas/${schedule.route.slug}`);
  redirectToBoard(dateKey, "Unidad quitada.", formData);
}

/**
 * La ficha del viaje especial guarda con control de versión (`updatedAt`). Cuando el tablero toca sus
 * naves, se actualiza también el viaje: si alguien tiene la ficha abierta, al guardar le avisa que el
 * viaje cambió en vez de pisar lo que se hizo acá.
 */
async function touchTrip(tx: Prisma.TransactionClient, tripId: string) {
  await tx.specialTrip.update({ where: { id: tripId }, data: { updatedAt: new Date() } });
}

async function auditTrip(actor: Awaited<ReturnType<typeof getCurrentReservationsUserOrRedirect>>, tripId: string, client: string, summary: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  await recordEntityAuditAfterCommit(prisma, { actor, entity: "SPECIAL_TRIP", entityId: tripId, entityLabel: client.slice(0, 120), action: "UPDATE", summary, before, after });
}

/** Chofer de una nave de un viaje especial. */
export async function setSpecialDriverAction(formData: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const id = value(formData, "id");
  const driverId = value(formData, "driverId") || null;
  const assignment = await prisma.specialTripAssignment.findUnique({
    where: { id },
    select: { driverId: true, tripId: true, vehicle: { select: { name: true } }, driver: { select: { name: true, email: true } }, trip: { select: { client: true, serviceDate: true } } }
  });
  const fallback = boardDate(formData, new Date());
  if (!assignment) redirectToBoard(fallback, "Esa nave ya no está en el viaje.", formData);
  const dateKey = assignment.trip.serviceDate.toISOString().slice(0, 10);
  if (assignment.driverId === driverId) redirectToBoard(dateKey, "La nave ya tenía ese chofer.", formData);
  const driver = driverId ? await activeDriver(driverId) : null;
  if (driverId && !driver) redirectToBoard(dateKey, "Ese chofer no está disponible: elegí un chofer activo.", formData);
  await prisma.$transaction(async (tx) => {
    await tx.specialTripAssignment.update({ where: { id }, data: { driverId } });
    await touchTrip(tx, assignment.tripId);
  });
  await auditTrip(actor, assignment.tripId, assignment.trip.client, `Chofer de la nave ${assignment.vehicle.name} cambiado en el viaje.`, { driver: personLabel(assignment.driver) }, { driver: personLabel(driver) });
  revalidatePath("/admin/salidas-del-dia");
  revalidatePath(`/admin/viajes-especiales/${assignment.tripId}`);
  redirectToBoard(dateKey, driverId ? "Chofer asignado al viaje." : "Chofer quitado del viaje.", formData);
}

/**
 * Sumar una nave a un viaje especial, con su horario (por defecto el de la primera nave del viaje).
 * Los choques se muestran y piden confirmación, igual que en la ficha del viaje.
 */
export async function addSpecialVehicleAction(_state: BoardFormState, formData: FormData): Promise<BoardFormState> {
  const actor = await getCurrentReservationsUserOrRedirect();
  const tripId = value(formData, "tripId");
  const vehicleId = value(formData, "vehicleId");
  const driverId = value(formData, "driverId") || null;
  const trip = await prisma.specialTrip.findUnique({ where: { id: tripId }, select: { id: true, client: true, serviceDate: true, status: true } });
  if (!trip) return { error: "El viaje ya no existe." };
  const dateKey = trip.serviceDate.toISOString().slice(0, 10);
  const startsAt = timeOnDay(dateKey, value(formData, "from"));
  const endsAt = timeOnDay(dateKey, value(formData, "to"));
  if (!vehicleId) return { error: "Elegí la nave." };
  if (!startsAt || !endsAt || endsAt <= startsAt) return { error: "Revisá el horario: «hasta» tiene que ser después de «desde»." };
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { name: true, isActive: true } });
  if (!vehicle?.isActive) return { error: "Esa nave no está disponible: elegí una unidad activa." };
  const driver = driverId ? await activeDriver(driverId) : null;
  if (driverId && !driver) return { error: "Ese chofer no está disponible: elegí un chofer activo." };

  const result = await prisma.$transaction(async (tx) => {
    await lockFleet(tx, [vehicleId]);
    const found = trip.status === "CANCELLED" ? [] : await fleetConflicts(tx, { vehicleId, startsAt, endsAt }, trip.id);
    const conflicts = [...new Map(found.map((c) => [c.id, c])).values()];
    const confirmation = conflictKey(conflicts, [trip.id, vehicleId, startsAt.toISOString(), endsAt.toISOString()]);
    if (conflicts.length && value(formData, "confirmation") !== confirmation) return { conflicts, confirmation };
    await tx.specialTripAssignment.create({ data: { tripId: trip.id, vehicleId, driverId, startsAt, endsAt } });
    await recordAcceptance(tx, "SPECIAL", trip.id, actor.id, conflicts);
    await touchTrip(tx, trip.id);
    return { saved: true };
  });
  if (!("saved" in result)) return result;
  await auditTrip(actor, trip.id, trip.client, `Nave ${vehicle.name} sumada al viaje.`, null, { vehicle: vehicle.name, driver: personLabel(driver), from: value(formData, "from"), to: value(formData, "to") });
  revalidatePath("/admin/salidas-del-dia");
  revalidatePath(`/admin/viajes-especiales/${trip.id}`);
  redirectToBoard(dateKey, "Nave sumada al viaje.", formData);
}

/** Quitar una nave de un viaje especial. */
export async function removeSpecialVehicleAction(formData: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const id = value(formData, "id");
  const assignment = await prisma.specialTripAssignment.findUnique({
    where: { id },
    select: { tripId: true, vehicle: { select: { name: true } }, driver: { select: { name: true, email: true } }, trip: { select: { client: true, serviceDate: true } } }
  });
  const fallback = boardDate(formData, new Date());
  if (!assignment) redirectToBoard(fallback, "Esa nave ya no está en el viaje.", formData);
  const dateKey = assignment.trip.serviceDate.toISOString().slice(0, 10);
  await prisma.$transaction(async (tx) => {
    await tx.specialTripAssignment.delete({ where: { id } });
    await touchTrip(tx, assignment.tripId);
  });
  await auditTrip(actor, assignment.tripId, assignment.trip.client, `Nave ${assignment.vehicle.name} quitada del viaje.`, { vehicle: assignment.vehicle.name, driver: personLabel(assignment.driver) }, null);
  revalidatePath("/admin/salidas-del-dia");
  revalidatePath(`/admin/viajes-especiales/${assignment.tripId}`);
  redirectToBoard(dateKey, "Nave quitada del viaje.", formData);
}

export async function replaceBoardVehicleAction(_state: CrewState, form: FormData): Promise<CrewState> {
  const actor = await getCurrentAdminOrRedirect();
  const ids = form.getAll("vehicleId");
  const drivers = form.getAll("driverId");
  if (ids.length !== drivers.length || [...ids, ...drivers].some(entry => typeof entry !== "string")) {
    return { error: "Revisá las naves y sus choferes." };
  }
  const result = await replaceRouteVehicle({
    actor, scheduleId: value(form, "scheduleId"), outgoingId: value(form, "outgoingId"),
    replacements: ids.map((id, i) => ({ vehicleId: String(id), driverId: String(drivers[i]) || null })),
    confirmation: value(form, "confirmation")
  });
  return afterUnitChange(result, form);
}
