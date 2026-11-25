import { getAirportServiceOrder } from "@/lib/airport/service-order-data";
import { prisma } from "@/lib/db/prisma";
import { dayRange } from "@/lib/operations/day-board";
import { buildRouteSheet } from "./route-sheet";
import { getRouteSheetInput } from "./route-sheet-repository";

async function assignedServices(driverIds: string[], date: string) {
  const { from, to } = dayRange(date);
  const driverId = { in: driverIds };
  const [{ blocks }, special, schedules] = await Promise.all([
    getAirportServiceOrder(date, null, { soloVuelosOperativos: true, incluirVacias: true }),
    prisma.specialTripAssignment.findMany({
      where: {
        driverId,
        startsAt: { lt: to },
        endsAt: { gt: from },
        trip: { status: { not: "CANCELLED" } }
      },
      select: {
        id: true, driverId: true, startsAt: true, endsAt: true, vehicle: { select: { name: true } },
        trip: { select: {
          client: true, contactName: true, contactPhone: true, contact: true,
          passengers: true, notes: true, legs: true, destinationSearch: true
        } }
      }
    }),
    prisma.schedule.findMany({
      where: {
        departureAt: { gte: from, lt: to },
        status: { not: "CANCELLED" },
        route: { bookingMode: "SEATED" },
        OR: [{ driverId }, { extraUnits: { some: { driverId } } }]
      },
      select: {
        id: true, departureAt: true, driverId: true, vehicle: { select: { name: true } },
        extraUnits: { where: { driverId }, select: { driverId: true, vehicle: { select: { name: true } } } }
      }
    })
  ]);

  // Se mantiene el reparto de pasajeros entre todas las naves antes de seleccionar los choferes.
  const airport = blocks.filter((block) => block.vehicle?.driverId && driverIds.includes(block.vehicle.driverId));
  return { airport, special, schedules };
}

export async function driversWithServiceOrders(driverIds: string[], date: string) {
  if (!driverIds.length) return new Set<string>();
  const driverId = { in: driverIds };
  const [{ airport, special, schedules }, guardias, concesiones, marcas] = await Promise.all([
    assignedServices(driverIds, date),
    prisma.chapelcoVehicleDuty.findMany({ where: { driverId, status: "ACTIVE", operationDay: {
      serviceDate: new Date(date), status: { not: "CANCELLED" } } }, select: { driverId: true } }),
    prisma.schoolRun.findMany({ where: { driverId, serviceDate: new Date(date) }, select: { driverId: true } }),
    prisma.driverServiceMark.findMany({ where: { driverId, fecha: date }, distinct: ["driverId"], select: { driverId: true } })
  ]);
  const assigned = new Set([
    ...[...guardias, ...concesiones, ...marcas].map(s => s.driverId),
    ...airport.map((block) => block.vehicle?.driverId),
    ...special.map((assignment) => assignment.driverId),
    ...schedules.flatMap((schedule) => [schedule.driverId, ...schedule.extraUnits.map((unit) => unit.driverId)])
  ]);
  return new Set(driverIds.filter((id) => assigned.has(id)));
}

export async function listDriverServiceOrders(driverId: string, date: string) {
  const { airport, special, schedules } = await assignedServices([driverId], date);
  const routes = await Promise.all(schedules.map(async (schedule) => {
    const vehicles = [schedule, ...schedule.extraUnits]
      .filter((unit) => unit.driverId === driverId).map((unit) => unit.vehicle.name);
    if (!vehicles.length) return null;
    const input = await getRouteSheetInput(schedule.id);
    if (!input || input.status === "CANCELLED") return null;
    return {
      type: "route" as const, id: schedule.id, at: schedule.departureAt, vehicles,
      sheet: buildRouteSheet(input)
    };
  }));

  return [
    ...airport.map((block) => ({ type: "airport" as const, id: block.key, at: block.operationAt, block })),
    ...special.map((assignment) => ({ type: "special" as const, id: assignment.id, at: assignment.startsAt, assignment })),
    ...routes.filter((route) => route !== null)
  ].sort((a, b) => +a.at - +b.at || a.id.localeCompare(b.id));
}
