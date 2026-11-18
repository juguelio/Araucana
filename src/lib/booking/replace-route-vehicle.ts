import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { AuditActor } from "@/lib/audit/record";
import { recordScheduleAudit } from "@/lib/audit/schedule";
import { conflictKey, driverConflicts, fleetConflicts, lockFleet, recordAcceptance, type FleetConflict } from "@/lib/special-trips/conflicts";
import type { UnitResult } from "./schedule-unit-service";
import { extraUnitsSeatsInclude, scheduleSeatPool } from "./schedule-units";

type Crew = { vehicleId: string; driverId: string | null };
type Replacement = {
  actor: AuditActor & { id: string };
  scheduleId: string;
  outgoingId: string;
  replacements: Crew[];
  confirmation: string;
};

const include = {
  route: { select: { slug: true, bookingMode: true } },
  vehicle: { include: { seats: true } },
  extraUnits: extraUnitsSeatsInclude,
  reservations: { select: { id: true, passengerCount: true, seatId: true, seatNumber: true, status: true }, orderBy: { id: "asc" as const } }
} satisfies Prisma.ScheduleInclude;

type Schedule = Prisma.ScheduleGetPayload<{ include: typeof include }>;

// Butacas internas. Conservamos las referencias válidas y liberamos las obsoletas antes de
// reasignarlas para respetar las dos claves únicas de butaca dentro de la salida.
async function reconcileSeats(tx: Prisma.TransactionClient, before: Schedule, after: Schedule) {
  const pool = scheduleSeatPool(after);
  const available = new Map(pool.map(seat => [seat.number, seat]));
  const byId = new Map(pool.map(seat => [seat.id, seat]));
  const displaced = [];
  for (const reservation of before.reservations) {
    const { seatId, seatNumber } = reservation;
    if (!seatId && !seatNumber) continue;
    if (reservation.status === "CANCELLED") {
      if (seatNumber) available.delete(seatNumber);
      const pinned = seatId && byId.get(seatId);
      if (pinned) available.delete(pinned.number);
      continue;
    }
    const seat = seatNumber && available.get(seatNumber);
    if (seat && (!seatId || seatId === seat.id)) available.delete(seat.number);
    else displaced.push(reservation);
  }
  if (!displaced.length) return;
  if (available.size < displaced.length) throw new Error("REPLACEMENT_SEATS");
  await tx.reservation.updateMany({ where: { id: { in: displaced.map(r => r.id) } }, data: { seatId: null, seatNumber: null } });
  const freeSeats = [...available.values()].sort((a,b) => a.unit - b.unit || a.row - b.row || a.column - b.column);
  for (const [i, reservation] of displaced.entries()) {
    const seat = freeSeats[i];
    await tx.reservation.update({ where: { id: reservation.id }, data: { seatId: reservation.seatId ? seat.id : null, seatNumber: seat.number } });
  }
}

export async function replaceRouteVehicle(input: Replacement): Promise<UnitResult> {
  const { scheduleId, outgoingId, replacements } = input;
  const ids = replacements.map(crew => crew.vehicleId);
  const driverIds = replacements.flatMap(crew => crew.driverId ? [crew.driverId] : []);
  if (!ids.length || ids.some(id => !id) || new Set(ids).size !== ids.length || ids.includes(outgoingId)) return { error: "Elegí naves de reemplazo distintas." };
  if (new Set(driverIds).size !== driverIds.length) return { error: "Cada nave necesita un chofer distinto." };
  try {
    return await prisma.$transaction(async (tx): Promise<UnitResult> => {
      await lockFleet(tx, [outgoingId, ...ids]);
      const before = await tx.schedule.findUnique({ where: { id: scheduleId }, include });
      if (!before) return { error: "La salida ya no existe." };
      const units = [before, ...before.extraUnits];
      const outgoing = units.find(unit => unit.vehicleId === outgoingId);
      if (!outgoing) return { error: "La asignación cambió. Actualizá la salida antes de reemplazar la nave." };
      const kept = units.filter(unit => unit !== outgoing);
      if (kept.some(unit => ids.includes(unit.vehicleId))) return { error: "Una de las naves elegidas ya cubre esta salida." };
      if (kept.some(unit => unit.driverId && driverIds.includes(unit.driverId))) return { error: "Ese chofer ya cubre otra nave de la salida." };
      const vehicles = await tx.vehicle.findMany({ where: { id: { in: ids }, isActive: true, kind: { not: "UTILITARIO" }, ...(before.route.bookingMode === "SEATED" ? { publicTransport: true } : {}) }, select: { id: true, name: true, _count: { select: { seats: true } } } });
      if (vehicles.length !== ids.length || vehicles.some(v => !v._count.seats)) return { error: "Revisá que las naves estén activas, habilitadas para esta salida y con lugares cargados." };
      const drivers = await tx.user.findMany({ where: { id: { in: driverIds }, role: "DRIVER", isActive: true }, select: { id: true, name: true, email: true } });
      if (drivers.length !== driverIds.length) return { error: "Elegí choferes activos." };
      const passengers = before.reservations.reduce((sum, r) => sum + (r.status === "CANCELLED" ? 0 : r.passengerCount), 0);
      const capacity = kept.reduce((sum, unit) => sum + (unit.vehicle.isActive ? unit.vehicle.seats.length : 0), 0) + vehicles.reduce((sum,v) => sum + v._count.seats, 0);
      if (capacity < passengers) return { error: `Hay ${passengers} pasajeros y quedarían ${capacity} lugares. Faltan ${passengers - capacity}.` };
      const interval = { startsAt: before.departureAt, endsAt: before.arrivalAt };
      const conflicts: FleetConflict[] = [];
      for (const vehicle of vehicles) {
        const hits = await fleetConflicts(tx, { ...interval, vehicleId: vehicle.id }, undefined, scheduleId);
        conflicts.push(...hits.map(hit => ({ ...hit, id: vehicle.id + ":" + hit.id, label: vehicle.name + " · " + hit.label })));
      }
      for (const driver of drivers) {
        const hits = await driverConflicts(tx, { ...interval, driverId: driver.id, excludeScheduleId: scheduleId });
        conflicts.push(...hits.map(hit => ({ ...hit, id: driver.id + ":" + hit.id, label: (driver.name || driver.email) + " · " + hit.label })));
      }
      const busy = conflicts.filter(c => !c.possible);
      if (busy.length) return { error: "Hay un cruce de horario: " + busy.map(c => c.label).join(", ") };
      const confirmation = conflictKey(conflicts, [scheduleId, outgoingId, replacements, capacity, passengers]);
      if (conflicts.length && confirmation !== input.confirmation) return { conflicts, confirmation };
      const [first, ...extras] = replacements;
      if (before.vehicleId === outgoingId) await tx.schedule.update({ where: { id: scheduleId }, data: first });
      else await tx.scheduleUnit.update({ where: { id: outgoing.id }, data: first });
      if (extras.length) await tx.scheduleUnit.createMany({ data: extras.map(crew => ({ scheduleId, ...crew })) });
      const after = await tx.schedule.findUniqueOrThrow({ where: { id: scheduleId }, include });
      await reconcileSeats(tx, before, after);
      const summary = `Reemplazo por avería de ${outgoing.vehicle.name}. ${passengers} pasajeros · ${capacity} lugares.`;
      await recordScheduleAudit(tx, input.actor, summary, before, after);
      await recordAcceptance(tx, "PUBLIC", scheduleId, input.actor.id, conflicts);
      return { ok: true, summary, schedule: { id: scheduleId, departureAt: before.departureAt, routeId: before.routeId, slug: before.route.slug } };
    }, { isolationLevel: "Serializable", timeout: 15000 });
  } catch (error) {
    if (error instanceof Error && error.message === "REPLACEMENT_SEATS") return { error: "Revisá las asignaciones históricas de butaca de esta salida antes de confirmar." };
    if (error && typeof error === "object" && "code" in error && ["P2034","P2002","P2025"].includes(String(error.code))) return { error: "La salida o la flota cambió mientras confirmabas. Actualizá y volvé a intentar." };
    throw error;
  }
}
