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
/**
 * Cuándo queda libre la unidad de un traslado al aeropuerto. La unidad no se ocupa hasta el despegue:
 * termina el traslado a los 90 minutos del pickup (o antes, si el avión sale antes). Un arribo se
 * extiende 90 minutos porque el reparto de pasajeros por los hoteles no termina en el aeropuerto.
 */
export function cierreDelTraslado(cuando: Date, direccion: string, despegue: Date) {
  const finTraslado = new Date(cuando.getTime() + 90 * 60_000);
  return direccion === "ARRIVAL" ? finTraslado : new Date(Math.min(finTraslado.getTime(), despegue.getTime()));
}

export async function cargarServiciosDelDia(dateKey = localDateKey(new Date())): Promise<ServicioDelDia[]> {
  const { from, to } = dayRange(dateKey);
  const serviceDate = new Date(`${dateKey}T00:00:00.000Z`);

  const [schedules, flights, chapelco, especiales] = await Promise.all([
    prisma.schedule.findMany({
      where: { departureAt: { gte: from, lt: to }, status: { not: "CANCELLED" }, route: { isActive: true } },
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
        status: { notIn: ["CANCELLED", "DIVERTED"] },
        source: { not: "RETIRADO" }, number: { notIn: [...VUELOS_QUE_NO_SE_OFRECEN] }
      },
      orderBy: { scheduledAt: "asc" },
      select: {
        id: true,
        number: true,
        direction: true,
        scheduledAt: true,
        pickupStartInitialAt: true,
        pickupStartOverrideAt: true,
        assignments: {
          select: {
            id: true,
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
          where: { serviceDate, status: { not: "CANCELLED" } },
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
        destinationSearch: true,
        passengers: true,
        serviceDate: true,
        assignments: {
          where: { startsAt: { lt: to }, endsAt: { gt: from } },
          select: {
            id: true,
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
    // La programación de temporada trae naves por defecto. Una reserva o una asignación
    // explícita de chofer convierte esa salida en trabajo operativo para el mapa.
    const pasajeros = schedule.reservations.reduce((total, reserva) => total + reserva.passengerCount, 0);
    if (pasajeros === 0 && !schedule.driver && !schedule.extraUnits.some(u => u.driver)) continue;

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
      rutaId: schedule.routeId,
      at: schedule.departureAt,
      endsAt: schedule.arrivalAt,
      titulo: `${schedule.route.from} → ${schedule.route.to}`,
      detalle: null,
      unidades,
      pasajeros,
      // La tripulación de una salida se cambia en el tablero del día, no en la ficha del recorrido.
      href: `/admin/salidas-del-dia?date=${dateKey}`
    });
  }

  for (const flight of flights) {
    const hora = airportPickupStart(flight);
    const cuando = hora instanceof Date && !Number.isNaN(hora.getTime()) ? hora : flight.scheduledAt;
    // El servicio es cuando hay que buscar al pasajero, no la hora de despegue.
    if (cuando < from || cuando >= to) continue;
    /**
     * La unidad queda libre cuando termina el traslado, no cuando despega el avión. En una partida se
     * tomaba la hora del vuelo como cierre: una combi que dejaba pasajeros a las 19:20 seguía «ocupada»
     * hasta el despegue de las 20:30 y chocaba con el arribo siguiente que perfectamente podía hacer.
     */
    const fin = cierreDelTraslado(cuando, flight.direction, flight.scheduledAt);
    servicios.push({
      id: `vuelo-${flight.id}`,
      area: "AEROPUERTO",
      fechaVuelo: localDateKey(flight.scheduledAt),
      at: cuando,
      endsAt: fin,
      titulo: `Aeropuerto · vuelo ${flight.number}`,
      detalle: flight.direction === "ARRIVAL" ? "llegada" : "salida",
      unidades: flight.assignments.map((assignment) => ({
        vehicleId: assignment.vehicle.id,
        vehicleName: assignment.vehicle.name,
        internalNumber: assignment.vehicle.internalNumber ?? null,
        driverId: assignment.driver?.id ?? null,
        driverName: assignment.driver?.name ?? null,
        assignmentId: assignment.id
      })),
      pasajeros: flight.reservations.reduce((total, detalle) => total + (detalle.reservation?.passengerCount ?? 0), 0),
      href: `/admin/aeropuerto?date=${dateKey}`
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
      href: `/admin/chapelco?date=${dateKey}`
    });
  }

  for (const trip of especiales) {
    const primera = trip.assignments[0];
    servicios.push({
      id: `especial-${trip.id}`,
      area: "ESPECIAL",
      at: primera?.startsAt && localDateKey(primera.startsAt) === dateKey ? primera.startsAt : null,
      endsAt: primera?.endsAt ?? null,
      titulo: `Viaje especial · ${trip.client}`,
      detalle: trip.destinationSearch.trim() || null,
      unidades: trip.assignments.map((assignment) => ({
        assignmentId: assignment.id,
        inicioAsignado: assignment.startsAt,
        finAsignado: assignment.endsAt,
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
