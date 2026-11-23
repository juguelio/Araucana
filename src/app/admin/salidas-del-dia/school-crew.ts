"use server";

import { revalidatePath } from "next/cache";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { recordEntityAudit } from "@/lib/audit/entity";
import { prisma } from "@/lib/db/prisma";
import { isDateKey, localDateKey } from "@/lib/operations/day-board";
import { schoolDates, schoolOccurrenceId } from "@/lib/operations/school-series";
import { redirectToBoard } from "./return-to";

export async function assignSchoolCrew(form: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const field = (name: string) => String(form.get(name) ?? "");
  const date = field("date"), id = field("id");
  if (!isDateKey(date)) redirectToBoard(localDateKey(new Date()), "Revisá la fecha del escolar.", form);
  const driverId = field("driverId") || null;
  const vehicleId = field("vehicleId") || null;
  const message = await prisma.$transaction(async tx => {
    const run = await tx.schoolRun.findUnique({ where: { id } });
    const stale = "El recorrido cambió. Revisá la asignación guardada antes de volver a editar.";
    if (!run || String(run.revision) !== field("revision") || run.serviceDate.toISOString().slice(0,10) !== date) return stale;
    if (driverId && run.driverId !== driverId && !await tx.user.findFirst({ where: { id: driverId, role: "DRIVER", isActive: true } })) return "Elegí un chofer activo.";
    if (vehicleId && run.vehicleId !== vehicleId && !await tx.vehicle.findFirst({ where: { id: vehicleId, isActive: true } })) return "Elegí una nave activa.";
    const updated = await tx.schoolRun.updateMany({ where: { id, revision: run.revision }, data: { driverId, vehicleId, revision: { increment: 1 } } });
    if (!updated.count) return stale;
    await recordEntityAudit(tx, { actor, entity: "SCHOOL_RUN", entityId: id, entityLabel: run.routeName,
      summary: "Equipo del recorrido actualizado para el " + date, before: { driverId: run.driverId, vehicleId: run.vehicleId }, after: { driverId, vehicleId } });
    return "Equipo guardado para la jornada.";
  });
  for (const path of ["/admin", "/admin/salidas-del-dia", "/admin/escolares", "/admin/escolares/" + id]) revalidatePath(path);
  redirectToBoard(date, message, form);
}

export async function repeatSchoolRun(form: FormData) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const field = (key: string) => String(form.get(key) ?? "");
  const date = field("date"), id = field("id");
  if (!isDateKey(date)) redirectToBoard(localDateKey(new Date()), "Revisá la fecha.", form);
  let dates: string[];
  try {
    dates = schoolDates(field("desde"), field("hasta"), form.getAll("dia").map(String), field("excepto"));
  } catch (error) {
    redirectToBoard(date, error instanceof Error ? error.message : "Revisá el período.", form);
  }
  const message = await prisma.$transaction(async tx => {
    const run = await tx.schoolRun.findUnique({ where: { id }, include: {
      vehicle: { select: { isActive: true } }, driver: { select: { isActive: true, role: true } }
    } });
    if (!run || String(run.revision) !== field("revision") || run.serviceDate.toISOString().slice(0,10) !== date) return "El recorrido cambió. Revisá el recorrido antes de repetirlo.";
    if ((run.vehicle && !run.vehicle.isActive) || (run.driver && (!run.driver.isActive || run.driver.role !== "DRIVER"))) return "Actualizá el equipo inactivo antes de repetir el recorrido.";
    const source = run.source;
    const base = source && typeof source === "object" && !Array.isArray(source) && source.type === "serie-escolar" && typeof source.base === "string" ? source.base : run.id;
    const existing = await tx.schoolRun.findMany({ where: { serviceDate: { in: dates.map(d => new Date(d)) }, kind: run.kind, routeName: run.routeName, shift: run.shift, driverId: run.driverId, vehicleId: run.vehicleId }, select: { serviceDate: true } });
    const occupied = new Set(existing.map(r => r.serviceDate.toISOString().slice(0,10)));
    const data = dates.filter(d => !occupied.has(d) && d !== date).map(d => ({
      id: schoolOccurrenceId(base, d), serviceDate: new Date(d), kind: run.kind, routeName: run.routeName, shift: run.shift, driverId: run.driverId, vehicleId: run.vehicleId,
      companion: run.companion, source: { type: "serie-escolar", base }
    }));
    const created = data.length ? (await tx.schoolRun.createMany({ data, skipDuplicates: true })).count : 0;
    if (created) await recordEntityAudit(tx, { actor, entity: "SCHOOL_RUN", entityId: id, entityLabel: run.routeName,
      summary: "Repetición de recorrido · " + created + " recorridos creados entre " + field("desde") + " y " + field("hasta") });
    return created ? "Recorridos creados: " + created + "." : "No había fechas nuevas para este recorrido.";
  });
  for (const path of ["/admin", "/admin/salidas-del-dia", "/admin/escolares"]) revalidatePath(path);
  redirectToBoard(date, message, form);
}
