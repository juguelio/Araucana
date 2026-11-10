import type { Prisma } from "@prisma/client";
import { dateOnly, localInput } from "./data";

type Interval = { vehicleId: string; startsAt: Date; endsAt: Date };
export type FleetConflict = { id: string; label: string; href: string; possible: boolean };

export function dayInterval(day: string) {
  const start = new Date(day + "T00:00:00-03:00");
  return { startsAt: start, endsAt: new Date(+start + 86_400_000) };
}

export async function lockFleet(tx: Prisma.TransactionClient, ids: string[]) {
  // All panel writers acquire the same per-vehicle locks in the same order.
  for (const id of [...new Set(ids)].sort()) {
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${id} FOR NO KEY UPDATE`;
  }
}

export async function specialConflicts(tx: Prisma.TransactionClient, interval: Interval, excludeTrip?: string, possible = false) {
  const hits = await tx.specialTripAssignment.findMany({
    where: {
      vehicleId: interval.vehicleId, startsAt: { lt: interval.endsAt }, endsAt: { gt: interval.startsAt },
      trip: { id: { not: excludeTrip }, status: { not: "CANCELLED" } }
    },
    include: { trip: { select: { client: true } } }
  });
  return hits.map((hit): FleetConflict => ({
    id: hit.id, label: `Viajes especiales · ${hit.trip.client}`, href: `/admin/viajes-especiales/${hit.tripId}`, possible
  }));
}

export async function fleetConflicts(tx: Prisma.TransactionClient, interval: Interval, excludeTrip?: string) {
  const { vehicleId, startsAt, endsAt } = interval;
  const first = localInput(startsAt).slice(0, 10);
  const last = localInput(new Date(+endsAt - 1)).slice(0, 10);
  const dateRange = { gte: dateOnly(first)!, lte: dateOnly(last)! };
  const flightRange = { gte: dayInterval(first).startsAt, lt: dayInterval(last).endsAt };
  const [special, schedules, chapelco, airport] = await Promise.all([
    specialConflicts(tx, interval, excludeTrip),
    tx.schedule.findMany({
      where: { vehicleId, departureAt: { lt: endsAt }, arrivalAt: { gt: startsAt }, status: { notIn: ["CANCELLED", "CANCELED", "CLOSED"] } },
      include: { route: { select: { from: true, to: true } } }
    }),
    tx.chapelcoVehicleDuty.findMany({
      where: { vehicleId, status: "ACTIVE", operationDay: { serviceDate: dateRange, status: { not: "CANCELLED" } } },
      include: { operationDay: true }
    }),
    tx.airportVehicleAssignment.findMany({
      where: { vehicleId, flight: { status: { notIn: ["CANCELLED", "DIVERTED"] }, OR: [{ scheduledAt: flightRange }, { estimatedAt: flightRange }, { pickupStartOverrideAt: flightRange }] } },
      include: { flight: true }
    })
  ]);
  return [
    ...special,
    ...schedules.map((s): FleetConflict => ({ id: s.id, label: `Servicio público · ${s.route.from} → ${s.route.to}`, href: `/admin/rutas/${s.routeId}/salidas/${s.id}`, possible: false })),
    ...chapelco.map((d): FleetConflict => ({ id: d.id, label: "Chapelco", href: `/admin/chapelco?date=${d.operationDay.serviceDate.toISOString().slice(0, 10)}`, possible: true })),
    ...airport.map((a): FleetConflict => ({ id: a.id, label: `Aeropuerto · ${a.flight.number}`, href: `/admin/aeropuerto?date=${localInput(a.flight.scheduledAt).slice(0, 10)}#vuelo-${a.flightId}`, possible: true }))
  ];
}

export function conflictKey(conflicts: FleetConflict[], proposal: unknown) {
  return JSON.stringify([proposal, [...new Set(conflicts.map(({ id, possible }) => `${id}:${possible}`))].sort()]);
}

export async function recordAcceptance(tx: Prisma.TransactionClient, service: string, serviceId: string, acceptedBy: string, conflicts: FleetConflict[]) {
  if (conflicts.length) await tx.fleetConflictAcceptance.create({ data: { service, serviceId, acceptedBy, conflicts } });
}


type ScheduleData = { routeId: string; vehicleId: string; departureAt: Date; arrivalAt: Date; status: string };

export async function savePublicSchedule(tx: Prisma.TransactionClient, data: ScheduleData, userId: string, acknowledgment: string, id?: string, statusOnly = false) {
  await lockFleet(tx, [data.vehicleId]);
  const conflicts = data.status === "CLOSED" ? [] : await specialConflicts(tx, {
    vehicleId: data.vehicleId, startsAt: data.departureAt, endsAt: data.arrivalAt
  });
  const confirmation = conflictKey(conflicts, [id, data]);
  if (conflicts.length && acknowledgment !== confirmation) return { conflicts, confirmation };
  const saved = id
    ? await tx.schedule.update({
      where: statusOnly ? { id, routeId: data.routeId, vehicleId: data.vehicleId, departureAt: data.departureAt, arrivalAt: data.arrivalAt } : { id },
      data: statusOnly ? { status: data.status } : data
    })
    : await tx.schedule.create({ data });
  await recordAcceptance(tx, "PUBLIC", saved.id, userId, conflicts);
  return { id: saved.id };
}
