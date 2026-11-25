import type { Prisma } from "@prisma/client";
import { recordScheduleAudit } from "@/lib/audit/schedule";
import { primaryVehicleProblem } from "@/lib/booking/schedule-unit-service";
import { prisma } from "@/lib/db/prisma";
import { dayRange, localDateKey } from "@/lib/operations/day-board";
import { conflictKey, driverConflicts, fleetConflicts, recordAcceptance } from "@/lib/special-trips/conflicts";
import type { AssignTripInput, AssignTripResult, PendingTrip } from "./assign-trip-types";
import { schoolTripConflicts } from "./school-trip-conflicts";

const time = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Salta"
});

function pendingWhere(day: string, upcoming = false): Prisma.ScheduleWhereInput {
  const { from, to } = dayRange(day);
  return {
    vehicleId: null,
    extraUnits: { none: {} },
    departureAt: upcoming ? { gte: from } : { gte: from, lt: to },
    status: { in: ["OPEN", "DOCUMENTATION"] },
    route: { isActive: true, bookingMode: { notIn: ["AIRPORT", "CHAPELCO"] } }
  };
}

export async function listPendingScheduleTrips(day: string, upcoming = false): Promise<PendingTrip[]> {
  const departures = await prisma.schedule.findMany({
    where: pendingWhere(day, upcoming),
    orderBy: { departureAt: "asc" },
    select: { id: true, departureAt: true, arrivalAt: true, driver: { select: { name: true, email: true } }, route: { select: { from: true, to: true, via: true } } }
  });
  return departures.map((departure) => ({
    kind: "schedule",
    id: departure.id,
    title: `${departure.route.from} → ${departure.route.to}`,
    detail: [
      `${time.format(departure.departureAt)}–${time.format(departure.arrivalAt)}`,
      departure.route.via,
      departure.driver ? `Chofer actual: ${departure.driver.name || departure.driver.email}` : null
    ].filter(Boolean).join(" · "),
    day: localDateKey(departure.departureAt),
    startsAt: +departure.departureAt,
    service: "Servicio público"
  }));
}

export async function assignScheduleTrip(tx: Prisma.TransactionClient, input: AssignTripInput): Promise<AssignTripResult> {
  const { id, day, vehicleId, driverId, actor } = input;
  const where = { id, ...pendingWhere(day) };
  const before = await tx.schedule.findFirst({ where });
  if (!before) return { error: "La salida ya no está pendiente de nave para ese día." };

  const capacityProblem = await primaryVehicleProblem(tx, id, vehicleId);
  if (capacityProblem) return { error: capacityProblem };

  const interval = { startsAt: before.departureAt, endsAt: before.arrivalAt, driverId, vehicleId };
  const [fleet, driver, school] = await Promise.all([
    fleetConflicts(tx, interval, undefined, id),
    driverConflicts(tx, interval),
    schoolTripConflicts(tx, interval)
  ]);
  const conflicts = [...fleet, ...driver.filter((c) => c.id !== `chofer:${id}`), ...school];
  const blocked = conflicts.filter((c) => !c.possible);
  if (blocked.length) return { error: `Ya hay servicios asignados en ese horario: ${blocked.map((c) => c.label).join(" · ")}.` };
  const confirmation = conflictKey(conflicts, ["schedule", id, day, vehicleId, driverId, before.departureAt, before.arrivalAt]);
  if (conflicts.length && input.confirmation !== confirmation) return { conflicts, confirmation };

  const saved = await tx.schedule.updateMany({ where, data: { vehicleId, driverId } });
  if (!saved.count) return { error: "La salida cambió mientras elegías. Volvé a revisar los viajes pendientes." };
  await recordScheduleAudit(tx, actor, "Nave y chofer asignados desde Choferes.", before, { ...before, vehicleId, driverId });
  await recordAcceptance(tx, "PUBLIC", id, actor.id, conflicts);
  return { saved: true };
}
