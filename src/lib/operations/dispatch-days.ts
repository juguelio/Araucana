import { butacasParaAeropuerto, pasajerosOcupados } from "@/lib/airport/booking";
import { airportServiceWindow } from "@/lib/airport/service-window";
import { esUnaRecorrida } from "@/lib/airport/service-order";
import { airportPickupStart } from "@/lib/airport/pickup-start";
import { VUELOS_QUE_NO_SE_OFRECEN } from "@/lib/airport/offered-flights";
import { CHAPELCO_BOOKING_MODE, chapelcoActiveReservationStatuses } from "@/lib/chapelco/constants";
import { diaDelViaje, etiquetaRango, ultimoDia, whereSolapa, vigenteEn } from "@/lib/special-trips/rango";
import { prisma } from "@/lib/db/prisma";
import { buildDayBoard, dayRange, shiftDateKey, schoolWindow, personName } from "./day-board";
import { panelServiceHref, type DispatchAssignment } from "./dispatch";

export const seatsOf = (vehicle: { _count: { seats: number } }) => vehicle._count.seats;
export const VEHICLE_SELECT = { id: true, name: true, _count: { select: { seats: true } } } as const;
export const DRIVER_SELECT = { id: true, name: true, email: true } as const;

const ACTIVE_RESERVATION = { notIn: ["CANCELLED"] };

async function loadRange(first: string, after: string) {
  const { from } = dayRange(first);
  const to = dayRange(after).from;
  const flightRange = { gte: new Date(+from - 86400000), lt: new Date(+to + 86400000) };
  const serviceDates = { gte: new Date(first), lt: new Date(after) };
  const [schedules, flights, chapelcoRoutes, specialTrips, schools] = await Promise.all([
    prisma.schedule.findMany({
      where: { departureAt: { gte: from, lt: to } },
      orderBy: { departureAt: "asc" },
      include: {
        route: { select: { from: true, to: true, isActive: true } },
        vehicle: { select: VEHICLE_SELECT },
        driver: { select: DRIVER_SELECT },
        extraUnits: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { vehicle: { select: VEHICLE_SELECT }, driver: { select: DRIVER_SELECT } } },
        reservations: { where: { status: ACTIVE_RESERVATION }, select: { passengerCount: true } },
        _count: { select: { reservations: true } }
      }
    }),
    prisma.flight.findMany({
      where: { OR: [{ scheduledAt: flightRange }, { estimatedAt: flightRange }, { pickupStartOverrideAt: { gte: from, lt: to } },
        { pickupStartOverrideAt: { lt: from }, estimatedAt: { gte: from } }, { pickupStartOverrideAt: { lt: from }, estimatedAt: null, scheduledAt: { gte: from } }], number: { notIn: [...VUELOS_QUE_NO_SE_OFRECEN] } },
      orderBy: { scheduledAt: "asc" },
      include: {
        reservations: { include: { reservation: { select: { passengerCount: true, status: true } } } },
        assignments: { orderBy: { createdAt: "asc" }, include: { vehicle: { select: VEHICLE_SELECT }, driver: { select: DRIVER_SELECT } } }
      }
    }),
    prisma.travelRoute.findMany({
      where: { bookingMode: CHAPELCO_BOOKING_MODE, specialType: "CHAPELCO" },
      select: {
        id: true,
        chapelcoOperationDays: {
          where: { serviceDate: serviceDates },
          include: { vehicleDuties: { where: { status: "ACTIVE" }, include: { runs: { select: { id: true, direction: true, ascentSlot: true }, orderBy: { sequence: "asc" } }, vehicle: { select: { id: true, name: true } }, driver: { select: DRIVER_SELECT } } } }
        },
        directReservations: {
          where: { bookingMode: CHAPELCO_BOOKING_MODE, status: { in: [...chapelcoActiveReservationStatuses] }, chapelcoDetails: { serviceDate: serviceDates } },
          select: { passengerCount: true, chapelcoDetails: { select: { ascentSlot: true, serviceDate: true } } }
        }
      }
    }),
    prisma.specialTrip.findMany({
      where: { AND: [{ status: { not: "CANCELLED" } }, { OR: [whereSolapa(serviceDates.gte, serviceDates.lt), { assignments: { some: { startsAt: { lt: to }, endsAt: { gt: from } } } }] }] },
      include: { assignments: { where: { startsAt: { lt: to }, endsAt: { gt: from } }, orderBy: { startsAt: "asc" }, include: { coDriver: { select: DRIVER_SELECT }, vehicle: { select: VEHICLE_SELECT }, driver: { select: DRIVER_SELECT } } } }
    }),
    prisma.schoolRun.findMany({
      where: { serviceDate: serviceDates }, orderBy: [{ routeName: "asc" }, { id: "asc" }],
      select: { id: true, serviceDate: true, kind: true, routeName: true, shift: true, companion: true, revision: true,
        vehicle: { select: { id: true, name: true } }, driver: { select: DRIVER_SELECT } }
    })
  ]);
  return { schedules, flights, chapelcoRoutes, specialTrips, schools };
}

function dispatchDay(data: Awaited<ReturnType<typeof loadRange>>, dateKey: string) {
  const { from, to } = dayRange(dateKey);
  const serviceDate = new Date(dateKey);
  const schedules = data.schedules.filter(s => s.departureAt >= from && s.departureAt < to);
  const flights = data.flights.filter(f => {
    if (f.scheduledAt >= from && f.scheduledAt < to) return true;
    if (["CANCELLED", "DIVERTED"].includes(f.status)) return false;
    const window = airportServiceWindow(f);
    return window.startsAt < to && window.endsAt > from;
  });
  const specialTrips = data.specialTrips.filter(trip => vigenteEn(trip, serviceDate) ||
    trip.assignments.some(a => a.startsAt < to && a.endsAt > from));
  const chapelcoRoutes = data.chapelcoRoutes;
  const board = buildDayBoard({
    dateKey,
    schools: data.schools.filter(school => +school.serviceDate === +serviceDate),
    schedules: schedules.map((schedule) => ({
      id: schedule.id,
      routeId: schedule.routeId,
      routeActive: schedule.route.isActive,
      from: schedule.route.from,
      to: schedule.route.to,
      departureAt: schedule.departureAt,
      status: schedule.status,
      passengers: schedule.reservations.reduce((sum, reservation) => sum + reservation.passengerCount, 0),
      reservations: schedule._count.reservations,
      vehicle: { id: schedule.vehicle.id, name: schedule.vehicle.name, seats: seatsOf(schedule.vehicle) },
      driver: schedule.driver,
      extraUnits: schedule.extraUnits.map((unit) => ({
        id: unit.id,
        vehicle: { id: unit.vehicle.id, name: unit.vehicle.name, seats: seatsOf(unit.vehicle) },
        driver: unit.driver
      }))
    })),
    flights: flights.map((flight) => ({
      id: flight.id,
      number: flight.number,
      direction: flight.direction,
      scheduledAt: flight.scheduledAt,
      estimatedAt: flight.estimatedAt,
      pickupStart: airportPickupStart(flight),
      status: flight.status,
      passengers: pasajerosOcupados(flight.reservations.map((detail) => detail.reservation)),
      units: flight.assignments.map((assignment) => ({
        id: assignment.id,
        // Aeropuerto: las unidades de menos de 26 butacas venden 4 menos (equipaje).
        vehicle: { id: assignment.vehicle.id, name: assignment.vehicle.name, seats: butacasParaAeropuerto(seatsOf(assignment.vehicle)) },
        driver: assignment.driver
      }))
    })),
    chapelco: chapelcoRoutes.map((route) => {
      const day = route.chapelcoOperationDays.find(item => +item.serviceDate === +serviceDate);
      const reservations = route.directReservations.filter(item => item.chapelcoDetails && +item.chapelcoDetails.serviceDate === +serviceDate);
      const slots = [
        ...reservations.map(reservation => reservation.chapelcoDetails?.ascentSlot),
        ...(day?.vehicleDuties ?? []).flatMap(duty => duty.runs.filter(run => run.direction === "UP").map(run => run.ascentSlot))
      ].filter((slot): slot is string => !!slot).sort();
      return {
        operationDayId: day?.id ?? null,
        routeId: route.id,
        dateKey,
        status: day?.status ?? "OPEN",
        passengers: reservations.reduce((sum, reservation) => sum + reservation.passengerCount, 0),
        firstAscent: slots[0] ? new Date(`${dateKey}T${slots[0]}:00-03:00`) : null,
        units: (day?.vehicleDuties ?? []).map((duty) => ({ id: duty.id, capacity: duty.capacity, vehicle: duty.vehicle, driver: duty.driver }))
      };
    }),
    specialTrips: specialTrips.map((trip) => {
      const day = diaDelViaje(trip, serviceDate);
      return {
        id: trip.id,
        client: trip.client,
        passengers: trip.passengers,
        status: trip.status,
        firstLegAt: null,
        day: day ? { number: day.numero, total: day.total, returnLabel: etiquetaRango({ serviceDate: ultimoDia(trip) }, serviceDate) } : null,
        continuing: day ? !day.primero : trip.serviceDate.toISOString().slice(0, 10) !== dateKey,
        units: trip.assignments.filter(a => a.startsAt < to && a.endsAt > from).map((assignment) => ({
          id: assignment.id,
          coDriver: assignment.coDriver,
          startsAt: assignment.startsAt,
          endsAt: assignment.endsAt,
          vehicle: { id: assignment.vehicle.id, name: assignment.vehicle.name, seats: seatsOf(assignment.vehicle) },
          driver: assignment.driver
        }))
      };
    })
  });

  const arrivalBySchedule = new Map(schedules.map(s => [s.id, s.arrivalAt.getTime()]));
  const runsByDuty = new Map(chapelcoRoutes.flatMap(route =>
    route.chapelcoOperationDays.flatMap(day => day.vehicleDuties.map(duty => [duty.id, duty.runs] as const))
  ));
  const flightById = new Map(flights.map(flight => [flight.id, flight]));
  const pickupGroups = new Map<string, typeof flights>();
  for (const flight of flights) {
    if (!flight.pickupGroupId) continue;
    const group = pickupGroups.get(flight.pickupGroupId) ?? [];
    group.push(flight);
    pickupGroups.set(flight.pickupGroupId, group);
  }
  const sharedPickups = new Set([...pickupGroups].filter(([, members]) => esUnaRecorrida(members)).map(([id]) => id));
  const assignments: DispatchAssignment[] = board.rows.filter(row => !row.school).flatMap(row => row.units.flatMap(unit => {
    const item = {
      programmed: row.programmed, key: unit.id, rowKey: row.key, cancelled: ["Cancelado", "Desviado", "Cancelada"].includes(row.status ?? ""), title: row.inactiveRoute ? row.title + " (ruta inactiva)" : row.title, area: row.area, href: panelServiceHref(dateKey, row.key),
      detail: row.area === "ESPECIAL" ? specialTrips.find(trip => trip.id === row.serviceId)?.destinationSearch : undefined,
      driverName: unit.driverName, coDriverId: unit.coDriverId, coDriverName: unit.coDriverName, vehicleName: unit.vehicleName,
      vehicleId: unit.vehicleId, driverId: unit.driverId,
      start: (unit.from ?? row.at)?.getTime() ?? null,
      end: unit.to?.getTime() ?? arrivalBySchedule.get(unit.scheduleId ?? "") ?? null
    };
    const flight = row.area === "AEROPUERTO" && flightById.get(row.serviceId);
    if (flight) {
      const { startsAt, endsAt } = airportServiceWindow(flight);
      if (startsAt >= to || endsAt <= from) return [];
      return [{ ...item, orderDate: row.flightDate, start: startsAt.getTime(), end: endsAt.getTime(), estimatedWindow: true,
        sharedPickupId: flight.pickupGroupId && sharedPickups.has(flight.pickupGroupId) ? flight.pickupGroupId : null }];
    }
    if (row.area !== "CHAPELCO") return [item];
    const runs = runsByDuty.get(unit.id) ?? [];
    if (!runs.length) return [{ ...item, start: null }];
    return runs.map(run => ({
      ...item, key: run.id, title: run.direction === "UP" ? "Subida al cerro" : "Bajada del cerro",
      start: run.ascentSlot ? Date.parse(`${dateKey}T${run.ascentSlot}:00-03:00`) : null
    }));
  }));
  for (const row of board.rows) {
    const school = row.school;
    if (!school || (!school.vehicle && !school.driver)) continue;
    const { start, end } = schoolWindow(dateKey, school.shift);
    assignments.push({
      key: row.key, rowKey: row.key, area: row.area, title: row.title, href: panelServiceHref(dateKey, row.key),
      shift: school.shift, detail: row.detail ?? undefined, start: start?.getTime() ?? null, end: end?.getTime() ?? null,
      driverId: school.driver?.id ?? null, driverName: personName(school.driver),
      vehicleId: school.vehicle?.id ?? null, vehicleName: school.vehicle?.name ?? "Sin nave asignada"
    });
  }
  return { date: dateKey, board, assignments };
}

export async function readDispatchDays(first: string, count: 1 | 7 = 1) {
  const data = await loadRange(first, shiftDateKey(first, count));
  return Array.from({ length: count }, (_, index) => dispatchDay(data, shiftDateKey(first, index)));
}
