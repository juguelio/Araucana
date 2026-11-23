"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { argentina, assignmentSchema, localDateTime } from "@/lib/special-trips/data";
import { conflictKey, driverConflicts, fleetConflicts, lockFleet, recordAcceptance, type FleetConflict } from "@/lib/special-trips/conflicts";
import { recordEntityAudit } from "@/lib/audit/entity";

type Resultado = { ok?: boolean; error?: string; conflicts?: FleetConflict[]; confirmation?: string };

export async function asignarNavesPendientes(id: string, version: string, items: unknown, confirmation: string): Promise<Resultado> {
  const actor = await getCurrentReservationsUserOrRedirect();
  const parsed = z.array(assignmentSchema).min(1).max(50).safeParse(items);
  if (!parsed.success) return { error: "Elegí una nave por fila (hasta 50)." };
  const assignments: { tripId: string; vehicleId: string; driverId: string | null; startsAt: Date; endsAt: Date }[] = [];
  for (const item of parsed.data) {
    const startsAt = localDateTime(item.start, argentina);
    const endsAt = localDateTime(item.end, argentina);
    if (!startsAt || !endsAt || endsAt <= startsAt) return { error: "Revisá los horarios de cada nave." };
    assignments.push({ tripId: id, vehicleId: item.vehicleId, driverId: item.driverId || null, startsAt, endsAt });
  }
  for (const [index, a] of assignments.entries()) {
    if (assignments.slice(index + 1).some(b => a.startsAt < b.endsAt && a.endsAt > b.startsAt &&
        (a.vehicleId === b.vehicleId || (a.driverId && a.driverId === b.driverId)))) {
      return { error: "Una nave o un chofer se repite en horarios superpuestos." };
    }
  }
  const result = await prisma.$transaction(async (tx): Promise<Resultado> => {
    await tx.$queryRaw`SELECT id FROM "SpecialTrip" WHERE id = ${id} FOR UPDATE`;
    const trip = await tx.specialTrip.findUnique({ where: { id }, select: { client: true, status: true, updatedAt: true, _count: { select: { assignments: true } } } });
    if (!trip || !["PENDING", "CONFIRMED"].includes(trip.status) || trip.updatedAt.toISOString() !== version || trip._count.assignments) {
      return { error: "El viaje cambió. Cerrá el modal y actualizá el listado." };
    }
    const vehicles = [...new Set(assignments.map(a => a.vehicleId))];
    const drivers = [...new Set(assignments.flatMap(a => a.driverId ? [a.driverId] : []))].sort();
    await lockFleet(tx, vehicles);
    for (const driver of drivers) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${driver} FOR NO KEY UPDATE`;
    if (await tx.vehicle.count({ where: { id: { in: vehicles }, isActive: true, kind: { not: "UTILITARIO" } } }) !== vehicles.length ||
        await tx.user.count({ where: { id: { in: drivers }, role: "DRIVER", isActive: true } }) !== drivers.length) {
      return { error: "Elegí naves y choferes activos." };
    }
    const hits: FleetConflict[] = [];
    for (const a of assignments) {
      hits.push(...await fleetConflicts(tx, a, id));
      if (a.driverId) hits.push(...await driverConflicts(tx, { ...a, driverId: a.driverId }));
    }
    const conflicts = [...new Map(hits.map(hit => [hit.id, hit])).values()];
    const key = conflictKey(conflicts, [id, version, assignments]);
    if (conflicts.length && key !== confirmation) return { conflicts, confirmation: key };
    await tx.specialTripAssignment.createMany({ data: assignments });
    await tx.specialTrip.update({ where: { id }, data: { updatedAt: new Date() } });
    await recordAcceptance(tx, "SPECIAL", id, actor.id, conflicts);
    await recordEntityAudit(tx, { actor, entity: "SPECIAL_TRIP", entityId: id, entityLabel: trip.client,
      action: "UPDATE", summary: "Asignación de naves y choferes desde el listado.", after: { asignaciones: JSON.stringify(parsed.data) } });
    return { ok: true };
  });
  if (result.ok) {
    revalidatePath("/admin/viajes-especiales");
    revalidatePath(`/admin/viajes-especiales/${id}`);
    revalidatePath("/admin/salidas-del-dia");
  }
  return result;
}
