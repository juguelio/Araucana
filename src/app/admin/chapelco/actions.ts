"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { CHAPELCO_BOOKING_MODE } from "@/lib/chapelco/constants";
import { addChapelcoVehicleDuty } from "@/lib/chapelco/repository";
import { conflictKey, dayInterval, lockFleet, recordAcceptance, specialConflicts, type FleetConflict } from "@/lib/special-trips/conflicts";
import { dateOnly } from "@/lib/special-trips/data";
import { prisma } from "@/lib/db/prisma";
import { readForAudit, recordEntityAudit, recordEntityAuditAfterCommit } from "@/lib/audit/entity";
import { redirectToBoard, returnsToBoard } from "../salidas-del-dia/return-to";

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function chapelcoRedirect(date: string, notice: string): never {
  redirect(`/admin/chapelco?date=${encodeURIComponent(date)}&notice=${encodeURIComponent(notice)}`);
}

function serviceDateFromKey(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function updateChapelcoSeasonAction(formData: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const routeId = value(formData, "routeId");
  const serviceDate = value(formData, "serviceDate") || value(formData, "serviceStartDate");
  const serviceStartDate = value(formData, "serviceStartDate");
  const serviceEndDate = value(formData, "serviceEndDate");

  if (!routeId || !isDateKey(serviceStartDate) || !isDateKey(serviceEndDate)) {
    chapelcoRedirect(serviceDate, "Completa fecha inicio y fecha fin de Chapelco.");
  }

  if (serviceDateFromKey(serviceStartDate) > serviceDateFromKey(serviceEndDate)) {
    chapelcoRedirect(serviceDate, "La fecha inicio no puede ser posterior a la fecha fin.");
  }

  const previous = await readForAudit(() => prisma.travelRoute.findUnique({ where: { id: routeId }, select: { serviceStartDate: true, serviceEndDate: true } }));
  const updated = await prisma.travelRoute.updateMany({
    where: {
      id: routeId,
      bookingMode: CHAPELCO_BOOKING_MODE
    },
    data: {
      serviceStartDate: serviceDateFromKey(serviceStartDate),
      serviceEndDate: serviceDateFromKey(serviceEndDate)
    }
  });

  if (updated.count === 0) {
    chapelcoRedirect(serviceDate, "No encontramos la ruta Chapelco para actualizar.");
  }
  await recordEntityAuditAfterCommit(prisma, {
    actor, entity: "CHAPELCO", entityId: routeId, entityLabel: "Temporada Chapelco", action: "UPDATE",
    summary: "Fechas de la temporada de Chapelco modificadas.",
    before: previous, after: { serviceStartDate: serviceDateFromKey(serviceStartDate), serviceEndDate: serviceDateFromKey(serviceEndDate) }
  });

  revalidatePath("/admin/chapelco");
  revalidatePath("/reservar/chapelco");
  chapelcoRedirect(serviceDate, "Temporada Chapelco guardada.");
}

export async function assignChapelcoVehicle(_state: unknown, form: FormData): Promise<{ error?: string; conflicts?: FleetConflict[]; confirmation?: string }> {
  const user = await getCurrentReservationsUserOrRedirect();
  const routeId = value(form, "routeId");
  const day = value(form, "serviceDate");
  const serviceDate = dateOnly(day);
  const vehicleId = value(form, "vehicleId");
  if (!serviceDate || !vehicleId) return { error: "Elegí la fecha y una nave." };

  const result = await prisma.$transaction(async (tx) => {
    await lockFleet(tx, [vehicleId]);
    const [route, vehicle] = await Promise.all([
      tx.travelRoute.findFirst({ where: { id: routeId, bookingMode: CHAPELCO_BOOKING_MODE, specialType: "CHAPELCO" } }),
      tx.vehicle.findFirst({ where: { id: vehicleId, isActive: true }, include: { _count: { select: { seats: true } } } })
    ]);
    if (!route || !vehicle || !vehicle._count.seats || vehicle._count.seats > 80) return { error: "Elegí una nave activa con cupos configurados." };
    const conflicts = await specialConflicts(tx, { vehicleId, ...dayInterval(day) }, undefined, true);
    const confirmation = conflictKey(conflicts, [routeId, day, vehicleId]);
    if (conflicts.length && value(form, "confirmation") !== confirmation) return { conflicts, confirmation };

    const operation = await tx.chapelcoOperationDay.upsert({
      where: { routeId_serviceDate: { routeId, serviceDate } },
      create: { routeId, serviceDate },
      update: {}
    });
    if (operation.status === "CANCELLED") return { error: "La operación de ese día está cancelada." };
    const current = await tx.chapelcoVehicleDuty.findUnique({ where: { operationDayId_vehicleId: { operationDayId: operation.id, vehicleId } } });
    const duty = await addChapelcoVehicleDuty({
      operationDayId: operation.id, vehicleId, capacity: vehicle._count.seats, driverId: current?.driverId, notes: current?.notes
    }, tx);
    await recordAcceptance(tx, "CHAPELCO", duty.id, user.id, conflicts);
    // Volver a asignar una nave que ya estaba activa ese día no cambia nada y no deja fila.
    if (current?.status !== "ACTIVE") {
      await recordEntityAudit(tx, {
        actor: user, entity: "CHAPELCO", entityId: operation.id, entityLabel: `Operación del ${day}`, action: "CREATE",
        summary: `Nave ${vehicle.name} asignada a la operación de Chapelco del ${day}.`,
        after: { vehicle: vehicle.name, capacity: vehicle._count.seats }
      });
    }
    return { saved: true };
  });
  if (!result.saved) return result;
  revalidatePath("/admin/chapelco");
  revalidatePath("/admin/salidas-del-dia");
  if (returnsToBoard(form)) redirectToBoard(day, "Nave asignada a Chapelco.", form);
  return chapelcoRedirect(day, "Nave asignada a Chapelco.");
}

export async function releaseChapelcoVehicle(form: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const id = value(form, "id");
  const duty = await prisma.chapelcoVehicleDuty.findUnique({
    where: { id }, include: { operationDay: true, vehicle: { select: { name: true } }, _count: { select: { runs: true } } }
  });
  if (!duty) return;
  const day = duty.operationDay.serviceDate.toISOString().slice(0, 10);
  if (duty._count.runs) {
    if (returnsToBoard(form)) redirectToBoard(day, "La nave tiene recorridos cargados para ese día.", form);
    chapelcoRedirect(day, "La nave tiene recorridos cargados para ese día.");
  }
  await prisma.chapelcoVehicleDuty.update({ where: { id }, data: { status: "INACTIVE" } });
  await recordEntityAuditAfterCommit(prisma, {
    actor, entity: "CHAPELCO", entityId: duty.operationDayId, entityLabel: `Operación del ${day}`, action: "DELETE",
    summary: `Nave ${duty.vehicle.name} quitada de la operación de Chapelco del ${day}.`,
    before: { vehicle: duty.vehicle.name, capacity: duty.capacity }
  });
  revalidatePath("/admin/chapelco");
  revalidatePath("/admin/salidas-del-dia");
  if (returnsToBoard(form)) redirectToBoard(day, "Nave quitada de la operación.", form);
  chapelcoRedirect(day, "Nave quitada de la operación.");
}
