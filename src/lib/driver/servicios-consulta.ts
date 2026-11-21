import { prisma } from "@/lib/db/prisma";
import { airportPickupStart } from "@/lib/airport/pickup-start";
import { VUELOS_QUE_NO_SE_OFRECEN } from "@/lib/airport/offered-flights";
import { CHAPELCO_BOOKING_MODE, chapelcoActiveReservationStatuses } from "@/lib/chapelco/constants";
import { dayRange, localDateKey } from "@/lib/operations/day-board";
import type { ServicioDelDia } from "./servicios";

/**
 * Servicios del día con su unidad asignada. Consulta acotada a lo que esta pantalla necesita: hora,
 * cierre estimado, título, unidades y pasajeros. **No** recalcula cupo, sobrecupo ni precios — de eso
 * se ocupa el tablero de salidas del día, que es su dueño.
 *
 * Se incluyen las cuatro modalidades porque el operador no piensa en módulos: piensa en «el de las 9».
 */
export async function cargarServiciosDelDia(dateKey = localDateKey(new Date())): Promise<ServicioDelDia[]> {
  const { from, to } = dayRange(dateKey);
  const serviceDate = new Date(`${dateKey}T00:00:00.000Z`);

  const [schedules, flights, chapelco, especiales] = await Promise.all([
    prisma.schedule.findMany({
      where: { departureAt: { gte: from, lt: to } },
      orderBy: { departureAt: "asc" },
      select: {
        id: true,
        routeId: true,
        departureAt: true,
        arrivalAt: true,
        route: { select: { from: true, to: true } },
        vehicle: { select: { id: true, name: true, internalNumber: true } },
        driver: { select: { id: true, name: true } },
        extraUnits: {
          select: {
            vehicle: { select: { id: true, name: true, internalNumber: true } },
            driver: { select: { id: true, name: true } }
          }
        },
        reservations: { where: { status: { notIn: ["CANCELLED"] } }, select: { passengerCount: true } }
      }
    }),
    prisma.flight.findMany({
      // Un vuelo de la 1:46 se busca la noche anterior: se abre la ventana y después se filtra por la
      // hora de pickup, que es cuando la unidad tiene que moverse.
      where: {
        scheduledAt: { gte: new Date(from.getTime() - 8 * 3_600_000), lt: new Date(to.getTime() + 8 * 3_600_000) },
        number: { notIn: [...VUELOS_QUE_NO_SE_OFRECEN] }
      },
      orderBy: { scheduledAt: "asc" },
      select: {
        id: true,
        number: true,
        direction: true,
        scheduledAt: true,
        estimatedAt: true,
        assignments: {
          select: {
            vehicle: { select: { id: true, name: true, internalNumber: true } },
            driver: { select: { id: true, name: true } }
          }
        },
        reservations: {
          where: { reservation: { status: { notIn: ["CANCELLED"] } } },
          select: { reservation: { select: { passengerCount: true } } }
        }
      }
    }),
    prisma.travelRoute.findMany({
      where: { bookingMode: CHAPELCO_BOOKING_MODE, specialType: "CHAPELCO" },
      select: {
        id: true,
        from: true,
        to: true,
        chapelcoOperationDays: {
          where: { serviceDate },
          select: {
            id: true,
            status: true,
            vehicleDuties: {
              where: { status: "ACTIVE" },
              select: {
                vehicle: { select: { id: true, name: true, internalNumber: true } },
                driver: { select: { id: true, name: true } }
              }
            }
          }
        },
        directReservations: {
          where: { bookingMode: CHAPELCO_BOOKING_MODE, status: { in: [...chapelcoActiveReservationStatuses] }, chapelcoDetails: { serviceDate } },
          select: { passengerCount: true, chapelcoDetails: { select: { ascentSlot: true } } }
        }
      }
    }),
    prisma.specialTrip.findMany({
      where: {
        status: { not: "CANCELLED" },
        assignments: { some: { startsAt: { lt: to }, endsAt: { gt: from } } }
      },
      select: {
        id: true,
        client: true,
        passengers: true,
        serviceDate: true,
        assignments: {
          where: { startsAt: { lt: to }, endsAt: { gt: from } },
          select: {
            startsAt: true,
            endsAt: true,
            vehicle: { select: { id: true, name: true, internalNumber: true } },
            driver: { select: { id: true, name: true } }
          }
        }
      }
    })
  ]);

  const servicios: ServicioDelDia[] = [];

  for (const schedule of schedules) {
    const unidades = [
      schedule.vehicle
        ? {
            vehicleId: schedule.vehicle.id,
            vehicleName: schedule.vehicle.name,
            internalNumber: schedule.vehicle.internalNumber ?? null,
            driverId: schedule.driver?.id ?? null,
            driverName: schedule.driver?.name ?? null
          }
        : null,
      ...schedule.extraUnits.map((unit) => ({
        vehicleId: unit.vehicle.id,
        vehicleName: unit.vehicle.name,
        internalNumber: unit.vehicle.internalNumber ?? null,
        driverId: unit.driver?.id ?? null,
        driverName: unit.driver?.name ?? null
      }))
    ].filter((unidad): unidad is NonNullable<typeof unidad> => unidad != null);

    servicios.push({
      id: `salida-${schedule.id}`,
      area: "RUTA",
      at: schedule.departureAt,
      endsAt: schedule.arrivalAt,
      titulo: `${schedule.route.from} → ${schedule.route.to}`,
      detalle: null,
      unidades,
      pasajeros: schedule.reservations.reduce((total, reserva) => total + reserva.passengerCount, 0),
      href: `/admin/rutas/${schedule.routeId ?? ""}`
    });
  }

  for (const flight of flights) {
    const hora = airportPickupStart(flight as never);
    const cuando = hora instanceof Date && !Number.isNaN(hora.getTime()) ? hora : flight.scheduledAt;
    // El servicio es cuando hay que buscar al pasajero, no la hora de despegue.
    if (cuando < from || cuando >= to) continue;
    const fin = flight.direction === "ARRIVAL"
      ? new Date(cuando.getTime() + 90 * 60_000)
      : flight.scheduledAt;
    servicios.push({
      id: `vuelo-${flight.id}`,
      area: "AEROPUERTO",
      at: cuando,
      endsAt: fin,
      titulo: `Aeropuerto · vuelo ${flight.number}`,
      detalle: flight.direction === "ARRIVAL" ? "llegada" : "salida",
      unidades: flight.assignments.map((assignment) => ({
        vehicleId: assignment.vehicle.id,
        vehicleName: assignment.vehicle.name,
        internalNumber: assignment.vehicle.internalNumber ?? null,
        driverId: assignment.driver?.id ?? null,
        driverName: assignment.driver?.name ?? null
      })),
      pasajeros: flight.reservations.reduce((total, detalle) => total + (detalle.reservation?.passengerCount ?? 0), 0),
      href: "/admin/aeropuerto"
    });
  }

  for (const route of chapelco) {
    const dia = route.chapelcoOperationDays[0] ?? null;
    if (!dia) continue;
    const slots = route.directReservations
      .map((reserva) => reserva.chapelcoDetails?.ascentSlot)
      .filter((slot): slot is string => Boolean(slot))
      .sort();
    const inicio = slots[0] ? new Date(`${dateKey}T${slots[0]}:00-03:00`) : null;
    servicios.push({
      id: `chapelco-${dia.id}`,
      area: "CHAPELCO",
      at: inicio,
      endsAt: inicio ? new Date(inicio.getTime() + 9 * 3_600_000) : null,
      titulo: `Chapelco · ${route.from} → ${route.to}`,
      detalle: dia.status === "OPEN" ? null : dia.status,
      unidades: dia.vehicleDuties.map((duty) => ({
        vehicleId: duty.vehicle.id,
        vehicleName: duty.vehicle.name,
        internalNumber: duty.vehicle.internalNumber ?? null,
        driverId: duty.driver?.id ?? null,
        driverName: duty.driver?.name ?? null
      })),
      pasajeros: route.directReservations.reduce((total, reserva) => total + reserva.passengerCount, 0),
      href: "/admin/chapelco"
    });
  }

  for (const trip of especiales) {
    const primera = trip.assignments[0];
    servicios.push({
      id: `especial-${trip.id}`,
      area: "ESPECIAL",
      at: primera?.startsAt && primera.startsAt.toISOString().slice(0, 10) === dateKey ? primera.startsAt : null,
      endsAt: primera?.endsAt ?? null,
      titulo: `Viaje especial · ${trip.client}`,
      detalle: null,
      unidades: trip.assignments.map((assignment) => ({
        vehicleId: assignment.vehicle.id,
        vehicleName: assignment.vehicle.name,
        internalNumber: assignment.vehicle.internalNumber ?? null,
        driverId: assignment.driver?.id ?? null,
        driverName: assignment.driver?.name ?? null
      })),
      pasajeros: trip.passengers ?? 0,
      href: "/admin/viajes-especiales"
    });
  }

  return servicios;
}
