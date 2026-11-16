"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminOrRedirect, getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { recordScheduleAudit } from "@/lib/audit/schedule";
import { recordEntityAuditAfterCommit } from "@/lib/audit/entity";
import { formatAuditDate } from "@/lib/audit/labels";
import { vehicleConflictNotice } from "@/lib/booking/schedule-vehicle";
import { fleetConflicts, lockFleet } from "@/lib/special-trips/conflicts";
import { isDateKey, localDateKey } from "@/lib/operations/day-board";
import { redirectToBoard } from "./return-to";

export type CrewState = { error?: string };

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
  if (!vehicleChanged && !driverChanged) redirectToBoard(dateKey, "La salida ya tenía esa nave y ese chofer.");

  if (driverId && driverChanged && !(await activeDriver(driverId))) {
    return { error: "Ese chofer no está disponible: elegí un chofer activo." };
  }
  if (vehicleChanged) {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { isActive: true } });
    if (!vehicle?.isActive) return { error: "Esa nave no está disponible: elegí una unidad activa." };
  }

  const result = await prisma.$transaction(async (tx) => {
    if (vehicleChanged) {
      await lockFleet(tx, [vehicleId]);
      const conflicts = await fleetConflicts(tx, { vehicleId, startsAt: current.departureAt, endsAt: current.arrivalAt }, undefined, current.id);
      if (conflicts.length) return { error: vehicleConflictNotice(conflicts) };
    }
    const before = await tx.schedule.findUnique({ where: { id: current.id } });
    const updated = await tx.schedule.update({ where: { id: current.id }, data: { vehicleId, driverId } });
    const summary = vehicleChanged && driverChanged
      ? "Nave y chofer de la salida cambiados."
      : vehicleChanged ? "Nave de la salida cambiada." : driverId ? "Chofer de la salida asignado." : "Chofer de la salida quitado.";
    await recordScheduleAudit(tx, actor, summary, before, updated);
    return { summary };
  });
  if ("error" in result && result.error) return { error: result.error };

  revalidatePath("/admin/salidas-del-dia");
  revalidatePath(`/admin/rutas/${current.routeId}/salidas`);
  revalidatePath(`/admin/rutas/${current.routeId}/salidas/${current.id}`);
  if (vehicleChanged && current.route.slug) {
    revalidatePath(`/rutas/${current.route.slug}`);
    revalidatePath(`/reservar/${current.route.slug}`);
  }
  redirectToBoard(dateKey, vehicleChanged ? "Salida actualizada." : driverId ? "Chofer asignado a la salida." : "Chofer quitado de la salida.");
}

/** Chofer de una combi ya asignada a un vuelo. Agregar o quitar la combi sigue en las acciones del aeropuerto. */
export async function setAirportDriverAction(formData: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const id = value(formData, "id");
  const driverId = value(formData, "driverId") || null;
  const assignment = await prisma.airportVehicleAssignment.findUnique({
    where: { id },
    select: { driverId: true, flight: { select: { id: true, number: true, scheduledAt: true } }, vehicle: { select: { name: true } }, driver: { select: { name: true, email: true } } }
  });
  const fallbackDate = boardDate(formData, new Date());
  if (!assignment) redirectToBoard(fallbackDate, "Esa combi ya no está asignada al vuelo.");
  const dateKey = boardDate(formData, assignment.flight.scheduledAt);
  if (assignment.driverId === driverId) redirectToBoard(dateKey, "La combi ya tenía ese chofer.");
  const driver = driverId ? await activeDriver(driverId) : null;
  if (driverId && !driver) redirectToBoard(dateKey, "Ese chofer no está disponible: elegí un chofer activo.");

  await prisma.airportVehicleAssignment.update({ where: { id }, data: { driverId } });
  await recordEntityAuditAfterCommit(prisma, {
    actor, entity: "AIRPORT", entityId: assignment.flight.id,
    entityLabel: `${assignment.flight.number} · ${formatAuditDate(assignment.flight.scheduledAt)}`,
    action: "UPDATE",
    summary: `Chofer de la combi ${assignment.vehicle.name} cambiado en el vuelo.`,
    before: { driver: personLabel(assignment.driver) },
    after: { driver: personLabel(driver) }
  });
  revalidatePath("/admin/aeropuerto");
  revalidatePath("/admin/salidas-del-dia");
  redirectToBoard(dateKey, driverId ? "Chofer asignado a la combi." : "Chofer quitado de la combi.");
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
  if (!duty) redirectToBoard(fallbackDate, "Esa nave ya no está en la operación de Chapelco.");
  const day = duty.operationDay.serviceDate.toISOString().slice(0, 10);
  if (duty.driverId === driverId) redirectToBoard(day, "La nave ya tenía ese chofer.");
  const driver = driverId ? await activeDriver(driverId) : null;
  if (driverId && !driver) redirectToBoard(day, "Ese chofer no está disponible: elegí un chofer activo.");

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
  redirectToBoard(day, driverId ? "Chofer asignado a la nave." : "Chofer quitado de la nave.");
}
