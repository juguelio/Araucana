import type { Prisma } from "@prisma/client";
import { airportServiceWindow } from "@/lib/airport/service-window";
import { dateOnly, localInput } from "./data";

type Interval = { vehicleId: string; startsAt: Date; endsAt: Date };
export type FleetConflict = {
  id: string;
  label: string;
  href: string;
  possible: boolean;
  /** «driver» cuando lo ocupado es el chofer y no la nave. */
  subject?: "driver";
};

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

/**
 * `excludeSchedule` deja afuera la salida que se está guardando: al reasignar la nave desde el
 * calendario (issue #81) la propia salida no puede contarse como choque consigo misma.
 */
export async function fleetConflicts(
  tx: Prisma.TransactionClient,
  interval: Interval,
  excludeTrip?: string,
  excludeSchedule?: string
) {
  const { vehicleId, startsAt, endsAt } = interval;
  const first = localInput(startsAt).slice(0, 10);
  const last = localInput(new Date(+endsAt - 1)).slice(0, 10);
  const dateRange = { gte: dateOnly(first)!, lte: dateOnly(last)! };
  const flightRange = { gte: dayInterval(first).startsAt, lt: dayInterval(last).endsAt };
  const [special, schedules, chapelco, airport] = await Promise.all([
    specialConflicts(tx, interval, excludeTrip),
    tx.schedule.findMany({
      where: {
        // La nave puede ser la principal de la salida o una de las que se le sumaron.
        OR: [{ vehicleId }, { extraUnits: { some: { vehicleId } } }],
        departureAt: { lt: endsAt },
        arrivalAt: { gt: startsAt },
        ...(excludeSchedule ? { id: { not: excludeSchedule } } : {}),
        status: { notIn: ["CANCELLED", "CANCELED", "CLOSED"] }
      },
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

type DriverInterval = { driverId: string; startsAt: Date; endsAt: Date; excludeScheduleId?: string };

/**
 * Dónde más maneja el chofer en ese tramo: salidas de ruta (como nave principal o sumada), viajes
 * especiales, otros vuelos (y otras combis del mismo vuelo) y Chapelco ese día. `excludeAirport` deja
 * afuera la combi que se está guardando y, con `sameTrip`, los vuelos que hace en la misma vuelta.
 */
export async function driverConflicts(
  tx: Prisma.TransactionClient,
  interval: DriverInterval,
  excludeAirport?: { flightId: string; vehicleId: string; sameTrip?: string[] }
) {
  const { driverId, startsAt, endsAt } = interval;
  const first = localInput(startsAt).slice(0, 10);
  const last = localInput(new Date(+endsAt - 1)).slice(0, 10);
  // Los vuelos se traen con un día de margen para cada lado (un arribo de la noche anterior reparte
  // pasada la medianoche) y se filtran por su propia ventana de servicio.
  const flightRange = { gte: new Date(+dayInterval(first).startsAt - 86_400_000), lt: new Date(+dayInterval(last).endsAt + 86_400_000) };
  const activeSchedule = {
    ...(interval.excludeScheduleId ? { id: { not: interval.excludeScheduleId } } : {}),
    departureAt: { lt: endsAt }, arrivalAt: { gt: startsAt }, status: { notIn: ["CANCELLED", "CANCELED", "CLOSED"] }
  };
  const [schedules, units, special, chapelco, airport] = await Promise.all([
    tx.schedule.findMany({ where: { driverId, ...activeSchedule }, include: { route: { select: { from: true, to: true } } } }),
    tx.scheduleUnit.findMany({ where: { driverId, schedule: activeSchedule }, include: { schedule: { include: { route: { select: { from: true, to: true } } } } } }),
    tx.specialTripAssignment.findMany({
      where: { driverId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, trip: { status: { not: "CANCELLED" } } },
      include: { trip: { select: { client: true } } }
    }),
    tx.chapelcoVehicleDuty.findMany({
      where: { driverId, status: "ACTIVE", operationDay: { serviceDate: { gte: dateOnly(first)!, lte: dateOnly(last)! }, status: { not: "CANCELLED" } } },
      include: { operationDay: true }
    }),
    tx.airportVehicleAssignment.findMany({
      where: {
        driverId,
        // La combi que se guarda no choca consigo misma, ni con los vuelos que hace en la misma vuelta.
        ...(excludeAirport ? { NOT: { flightId: excludeAirport.flightId, vehicleId: excludeAirport.vehicleId } } : {}),
        ...(excludeAirport?.sameTrip?.length ? { flightId: { notIn: excludeAirport.sameTrip } } : {}),
        flight: { status: { notIn: ["CANCELLED", "DIVERTED"] }, OR: [{ scheduledAt: flightRange }, { estimatedAt: flightRange }] }
      },
      include: { flight: true }
    })
  ]);
  const route = (r: { from: string; to: string }) => `${r.from} → ${r.to}`;
  const conflict = (c: Omit<FleetConflict, "subject">): FleetConflict => ({ ...c, id: `chofer:${c.id}`, label: `Chofer · ${c.label}`, subject: "driver" });
  return [
    ...schedules.map((s) => conflict({ id: s.id, label: `Servicio público · ${route(s.route)}`, href: `/admin/rutas/${s.routeId}/salidas/${s.id}`, possible: false })),
    ...units.map((u) => conflict({ id: u.id, label: `Servicio público · ${route(u.schedule.route)}`, href: `/admin/rutas/${u.schedule.routeId}/salidas/${u.scheduleId}`, possible: false })),
    ...special.map((a) => conflict({ id: a.id, label: `Viajes especiales · ${a.trip.client}`, href: `/admin/viajes-especiales/${a.tripId}`, possible: false })),
    ...chapelco.map((d) => conflict({ id: d.id, label: "Chapelco", href: `/admin/chapelco?date=${d.operationDay.serviceDate.toISOString().slice(0, 10)}`, possible: true })),
    ...airport
      .filter((a) => {
        const window = airportServiceWindow(a.flight);
        return window.startsAt < endsAt && window.endsAt > startsAt;
      })
      .map((a) => conflict({ id: a.id, label: `Aeropuerto · ${a.flight.number}`, href: `/admin/aeropuerto?date=${localInput(a.flight.scheduledAt).slice(0, 10)}#vuelo-${a.flightId}`, possible: true }))
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
  // Al mover una salida que lleva varias naves, se controlan también las que se le sumaron.
  const extras = id && !statusOnly
    ? (await tx.scheduleUnit.findMany({ where: { scheduleId: id }, select: { vehicleId: true } })).map((unit) => unit.vehicleId)
    : [];
  const vehicleIds = [...new Set([data.vehicleId, ...extras])];
  await lockFleet(tx, vehicleIds);
  const conflicts = data.status === "CLOSED" ? [] : (await Promise.all(vehicleIds.map((vehicleId) => specialConflicts(tx, {
    vehicleId, startsAt: data.departureAt, endsAt: data.arrivalAt
  })))).flat();
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
