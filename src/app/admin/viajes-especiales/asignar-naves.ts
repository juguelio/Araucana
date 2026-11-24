"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { argentina, assignmentSchema, localDateTime } from "@/lib/special-trips/data";
import { conflictKey, driverConflicts, fleetConflicts, lockFleet, recordAcceptance, type FleetConflict } from "@/lib/special-trips/conflicts";
import { recordEntityAudit } from "@/lib/audit/entity";

type Resultado = { ok?: boolean; error?: string; conflicts?: FleetConflict[]; confirmation?: string; version?: string };

export async function asignarNavesPendientes(id: string, version: string, items: unknown, confirmation: string): Promise<Resultado> {
  return saveAssignments(id, version, items, confirmation, false);
}

export async function editarNavesDelViaje(id: string, version: string, items: unknown, confirmation: string): Promise<Resultado> {
  return saveAssignments(id, version, items, confirmation, true);
}

async function saveAssignments(id: string, version: string, items: unknown, confirmation: string, editing: boolean): Promise<Resultado> {
  const actor = await getCurrentReservationsUserOrRedirect();
  const parsed = z.array(assignmentSchema).min(editing ? 0 : 1).max(50).safeParse(items);
  if (!parsed.success) return { error: "Elegí una nave por fila (hasta 50)." };
  const assignments: { tripId: string; vehicleId: string; driverId: string | null; startsAt: Date; endsAt: Date }[] = [];
  for (const item of parsed.data) {
    const startsAt = localDateTime(item.start, argentina);
    const endsAt = localDateTime(item.end, argentina);
    if (!startsAt || !endsAt || endsAt <= startsAt) return { error: "Revisá los horarios de cada nave." };
    assignments.push({ tripId: id, vehicleId: item.vehicleId, driverId: item.driverId || null, startsAt, endsAt });
  }
  const overlaps = (a: typeof assignments[number], b: typeof assignments[number]) =>
    a.startsAt < b.endsAt && a.endsAt > b.startsAt &&
    (a.vehicleId === b.vehicleId || (a.driverId !== null && a.driverId === b.driverId));

  if (!editing && assignments.some((a, index) => assignments.slice(index + 1).some((b) => overlaps(a, b)))) {
    return { error: "Una nave o un chofer se repite en horarios superpuestos." };
  }
  const result = await prisma.$transaction(async (tx): Promise<Resultado> => {
    await tx.$queryRaw`SELECT id FROM "SpecialTrip" WHERE id = ${id} FOR UPDATE`;
    const trip = await tx.specialTrip.findUnique({
      where: { id }, select: {
        client: true, status: true, updatedAt: true,
        assignments: { select: { id: true, vehicleId: true, driverId: true, startsAt: true, endsAt: true } }
      }
    });
    if (!trip || trip.updatedAt.toISOString() !== version ||
        (!editing && (!["PENDING", "CONFIRMED"].includes(trip.status) || trip.assignments.length))) {
      return { error: editing
        ? "El viaje cambió en otra ficha. Volvé a abrirlo antes de guardar las naves."
        : "El viaje cambió. Cerrá el modal y actualizá el listado." };
    }
    const previous = trip.assignments;
    const previousVehicles = new Set(previous.map((a) => a.vehicleId));
    const previousDrivers = new Set(previous.map((a) => a.driverId));
    const vehicles = [...new Set(assignments.map(a => a.vehicleId))].filter((vehicleId) => !previousVehicles.has(vehicleId));
    const drivers = [...new Set(assignments.flatMap(a => a.driverId ? [a.driverId] : []))].filter((driverId) => !previousDrivers.has(driverId));
    await lockFleet(tx, [...previous, ...assignments].map((a) => a.vehicleId));
    const involvedDrivers = [...new Set([...previous, ...assignments].flatMap((a) => a.driverId ? [a.driverId] : []))].sort();
    for (const driver of involvedDrivers) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${driver} FOR NO KEY UPDATE`;
    if (await tx.vehicle.count({ where: { id: { in: vehicles }, isActive: true, kind: { not: "UTILITARIO" } } }) !== vehicles.length ||
        await tx.user.count({ where: { id: { in: drivers }, role: "DRIVER", isActive: true } }) !== drivers.length) {
      return { error: "Elegí naves y choferes activos." };
    }

    const matching = (a: typeof assignments[number]) => previous.find((p) =>
      p.vehicleId === a.vehicleId && p.driverId === a.driverId && +p.startsAt === +a.startsAt && +p.endsAt === +a.endsAt
    );
    if (editing && assignments.some((a, index) => assignments.slice(index + 1).some((b) =>
      overlaps(a, b) && (!matching(a) || !matching(b))
    ))) return { error: "Una nave o un chofer se repite en horarios superpuestos." };

    const changed = assignments.filter((a) => !matching(a));
    const hits: FleetConflict[] = [];
    if (trip.status !== "CANCELLED") {
      for (const a of changed) {
        hits.push(...await fleetConflicts(tx, a, id));
        if (a.driverId) hits.push(...await driverConflicts(tx, { ...a, driverId: a.driverId }, undefined, id));
      }
    }
    const conflicts = [...new Map(hits.map(hit => [hit.id, hit])).values()];
    const key = conflictKey(conflicts, [id, version, assignments]);
    if (conflicts.length && key !== confirmation) return { conflicts, confirmation: key };

    if (editing) {
      const kept = new Set(assignments.flatMap((a) => matching(a)?.id ?? []));
      const removed = previous.filter((a) => !kept.has(a.id)).map((a) => a.id);
      if (removed.length) await tx.specialTripAssignment.deleteMany({ where: { tripId: id, id: { in: removed } } });
    }
    if (changed.length) await tx.specialTripAssignment.createMany({ data: changed });
    const updated = await tx.specialTrip.update({
      where: { id }, data: { updatedAt: new Date(Math.max(Date.now(), +trip.updatedAt + 1)) }, select: { updatedAt: true }
    });
    await recordAcceptance(tx, "SPECIAL", id, actor.id, conflicts);
    await recordEntityAudit(tx, { actor, entity: "SPECIAL_TRIP", entityId: id, entityLabel: trip.client,
      action: "UPDATE", summary: editing ? "Asignaciones de naves y choferes editadas." : "Asignación de naves y choferes desde el listado.", after: { asignaciones: JSON.stringify(parsed.data) } });
    return editing ? { ok: true, version: updated.updatedAt.toISOString() } : { ok: true };
  });
  if (result.ok) {
    revalidatePath("/admin/viajes-especiales");
    revalidatePath(`/admin/viajes-especiales/${id}`);
    revalidatePath("/admin/viajes-especiales/semana");
    revalidatePath("/admin/choferes");
    revalidatePath("/admin/salidas-del-dia");
  }
  return result;
}
