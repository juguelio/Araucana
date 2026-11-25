import { airportServiceWindow } from "@/lib/airport/service-window";
import { prisma } from "@/lib/db/prisma";
import { localDateKey } from "@/lib/operations/day-board";
import { leerTurno } from "@/lib/school-runs/dia";
import type { DriverActivity } from "./activity";

const vehicle = { select: { name: true } } as const;

export async function listDriverActivity(driverId: string): Promise<DriverActivity[]> {
  const [schedules, airport, chapelco, specialTrips, concessions] = await Promise.all([
    prisma.schedule.findMany({
      where: { OR: [{ driverId }, { extraUnits: { some: { driverId } } }] },
      select: {
        id: true, routeId: true, departureAt: true, arrivalAt: true, driverId: true, status: true, vehicle,
        route: { select: { from: true, to: true } },
        extraUnits: { where: { driverId }, select: { id: true, vehicle } }
      }
    }),
    prisma.airportVehicleAssignment.findMany({
      where: { driverId },
      select: {
        id: true, vehicleId: true, vehicle,
        flight: { select: {
          id: true, number: true, direction: true, status: true, scheduledAt: true, estimatedAt: true, pickupStartInitialAt: true, pickupStartOverrideAt: true,
          reservations: {
            where: { reservation: { status: { not: "CANCELLED" } } },
            distinct: ["serviceDate"],
            orderBy: { serviceDate: "asc" },
            select: { serviceDate: true }
          }
        } }
      }
    }),
    prisma.chapelcoVehicleDuty.findMany({
      where: { driverId },
      select: {
        id: true, status: true, vehicle,
        operationDay: { select: { serviceDate: true, route: { select: { from: true, to: true } } } }
      }
    }),
    prisma.specialTripAssignment.findMany({
      where: { driverId },
      select: {
        id: true, startsAt: true, endsAt: true, vehicle,
        trip: { select: { id: true, client: true, destinationSearch: true, status: true } }
      }
    }),
    prisma.schoolRun.findMany({ where: { driverId }, select: { id: true, serviceDate: true, shift: true, routeName: true, vehicle } })
  ]);

  const routes: DriverActivity[] = schedules.flatMap((schedule) => {
    const href = `/admin/rutas/${schedule.routeId}/salidas/${schedule.id}`;
    const assignments = schedule.driverId === driverId ? [schedule, ...schedule.extraUnits] : schedule.extraUnits;
    return assignments.map((assignment) => ({
      id: `ruta-${assignment.id}`,
      area: "RUTA",
      date: localDateKey(schedule.departureAt),
      startsAt: schedule.departureAt,
      endsAt: schedule.arrivalAt,
      title: `${schedule.route.from} → ${schedule.route.to}`,
      vehicle: assignment.vehicle?.name ?? "Sin nave",
      status: schedule.status === "CANCELLED" ? "Cancelada" : undefined,
      links: [
        { href: `${href}/planilla`, label: "Ver planilla" },
        { href, label: "Ver salida", adminOnly: true }
      ]
    }));
  });

  const airportTransfers: DriverActivity[] = airport.map(({ id, flight, vehicleId, vehicle }) => {
    const window = airportServiceWindow(flight);
    const flightDate = localDateKey(flight.scheduledAt);
    const reservationDates = [...new Set(flight.reservations.map((item) => localDateKey(item.serviceDate)))];
    const orderDates = reservationDates.length ? reservationDates : [flightDate];
    return {
      id: `aeropuerto-${id}`,
      area: "AEROPUERTO",
      date: localDateKey(window.startsAt),
      ...window,
      title: `${flight.direction === "ARRIVAL" ? "IN" : "OUT"} · Vuelo ${flight.number}`,
      vehicle: vehicle.name,
      status: flight.status === "CANCELLED" ? "Vuelo cancelado" : flight.status === "DIVERTED" ? "Vuelo desviado" : undefined,
      links: [
        ...orderDates.map((orderDate) => ({
          href: `/admin/aeropuerto/orden-de-servicio/ver?${new URLSearchParams({ date: orderDate, flight: flight.id, vehicle: vehicleId })}`,
          label: orderDates.length === 1 ? "Ver orden de servicio" : `Ver orden del ${orderDate.split("-").reverse().join("/")}`
        })),
        { href: `/admin/aeropuerto?date=${flightDate}#vuelo-${flight.id}`, label: "Ver vuelo" }
      ]
    };
  });

  const skiDuties: DriverActivity[] = chapelco.map(({ id, operationDay, status, vehicle }) => {
    // Chapelco guarda el día como fecha sin hora, a medianoche UTC.
    const date = operationDay.serviceDate.toISOString().slice(0, 10);
    return {
      id: `chapelco-${id}`,
      area: "CHAPELCO",
      date,
      startsAt: null,
      endsAt: null,
      title: `${operationDay.route.from} → ${operationDay.route.to}`,
      vehicle: vehicle.name,
      status: status === "INACTIVE" ? "Nave liberada" : undefined,
      links: [{ href: `/admin/chapelco?date=${date}`, label: "Ver operación" }]
    };
  });

  const trips: DriverActivity[] = specialTrips.map(({ id, startsAt, endsAt, trip, vehicle }) => ({
    id: `especial-${id}`,
    area: "ESPECIAL",
    date: localDateKey(startsAt),
    startsAt,
    endsAt,
    title: trip.destinationSearch ? `${trip.client} · ${trip.destinationSearch}` : trip.client,
    vehicle: vehicle.name,
    status: trip.status === "CANCELLED" ? "Cancelado" : trip.status === "COMPLETED" ? "Realizado" : undefined,
    links: [
      { href: `/admin/viajes-especiales/${trip.id}`, label: "Ver viaje" },
      { href: `/admin/viajes-especiales/${trip.id}#planillas`, label: "Ver planillas" }
    ]
  }));

  const recurring: DriverActivity[] = concessions.map((run) => {
    const date = run.serviceDate.toISOString().slice(0, 10);
    const shift = leerTurno(run.shift);
    return {
      id: `concesion-${run.id}`, area: "CONCESION", date,
      startsAt: shift.minutos === null ? null : new Date(`${date}T${shift.clave}:00-03:00`), endsAt: null,
      title: `${run.routeName} · ${shift.etiqueta}`, vehicle: run.vehicle?.name ?? "Sin nave",
      links: [{ href: `/admin/escolares/${run.id}`, label: "Ver recorrido" }]
    };
  });
  return [...routes, ...airportTransfers, ...skiDuties, ...trips, ...recurring];
}
