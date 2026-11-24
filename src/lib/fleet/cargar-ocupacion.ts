import { airportServiceWindow } from "@/lib/airport/service-window";
import { prisma } from "@/lib/db/prisma";
import type { Ocupacion } from "./ocupacion";

const hora = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Salta" });

const SALIDA_ACTIVA = { notIn: ["CANCELLED", "CANCELED", "CLOSED"] };

/**
 * Todo lo que ocupa naves y choferes el día `dia` (YYYY-MM-DD, Argentina), con un día de margen de
 * cada lado: un viaje especial de varios días o un arribo de la noche anterior que reparte pasada la
 * medianoche. Mismas fuentes que `fleetConflicts` y `driverConflicts`.
 */
export async function cargarOcupacionDelDia(dia: string): Promise<Ocupacion[]> {
  const inicio = new Date(`${dia}T00:00:00-03:00`);
  const desde = new Date(inicio.getTime() - 86_400_000);
  const hasta = new Date(inicio.getTime() + 2 * 86_400_000);
  const diaUtc = new Date(`${dia}T00:00:00Z`);

  const [salidas, viajes, vuelos, chapelco] = await Promise.all([
    prisma.schedule.findMany({
      where: { departureAt: { lt: hasta }, arrivalAt: { gt: desde }, status: SALIDA_ACTIVA },
      select: {
        id: true, departureAt: true, arrivalAt: true, vehicleId: true, driverId: true,
        route: { select: { from: true, to: true } },
        extraUnits: { select: { vehicleId: true, driverId: true } }
      }
    }),
    prisma.specialTripAssignment.findMany({
      where: { startsAt: { lt: hasta }, endsAt: { gt: desde }, trip: { status: { not: "CANCELLED" } } },
      select: { id: true, tripId: true, vehicleId: true, driverId: true, startsAt: true, endsAt: true, trip: { select: { client: true } } }
    }),
    prisma.airportVehicleAssignment.findMany({
      where: {
        flight: {
          status: { notIn: ["CANCELLED", "DIVERTED"] },
          OR: [{ scheduledAt: { gte: desde, lt: hasta } }, { estimatedAt: { gte: desde, lt: hasta } }]
        }
      },
      select: {
        id: true, vehicleId: true, driverId: true, flightId: true, privateReservationId: true,
        flight: { select: { number: true, direction: true, scheduledAt: true, estimatedAt: true, pickupStartOverrideAt: true, status: true } }
      }
    }),
    prisma.chapelcoVehicleDuty.findMany({
      where: { status: "ACTIVE", operationDay: { serviceDate: diaUtc, status: { not: "CANCELLED" } } },
      select: { id: true, vehicleId: true, driverId: true }
    })
  ]);

  const lugar = (texto: string) => (texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim() === "san martin de los andes" ? "San Martín" : texto);

  return [
    ...salidas.map((salida): Ocupacion => ({
      clave: `salida:${salida.id}`,
      vehicleIds: [salida.vehicleId, ...salida.extraUnits.map((unidad) => unidad.vehicleId)],
      driverIds: [salida.driverId, ...salida.extraUnits.map((unidad) => unidad.driverId)].filter((id): id is string => Boolean(id)),
      desde: salida.departureAt,
      hasta: salida.arrivalAt,
      etiqueta: `Servicio público ${hora.format(salida.departureAt)} · ${lugar(salida.route.from)} → ${lugar(salida.route.to)}`,
      posible: false
    })),
    ...viajes.map((viaje): Ocupacion => ({
      clave: `viaje:${viaje.tripId}`,
      vehicleIds: [viaje.vehicleId],
      driverIds: viaje.driverId ? [viaje.driverId] : [],
      desde: viaje.startsAt,
      hasta: viaje.endsAt,
      etiqueta: `Viaje especial ${hora.format(viaje.startsAt)} · ${viaje.trip.client}`,
      posible: false
    })),
    ...vuelos.map((asignacion): Ocupacion => {
      const ventana = airportServiceWindow({ ...asignacion.flight, status: asignacion.flight.status ?? undefined });
      return {
        clave: asignacion.privateReservationId ? `privada:${asignacion.id}` : `vuelo:${asignacion.flightId}`,
        vehicleIds: [asignacion.vehicleId],
        driverIds: asignacion.driverId ? [asignacion.driverId] : [],
        desde: ventana.startsAt,
        hasta: ventana.endsAt,
        etiqueta: `Aeropuerto ${hora.format(ventana.startsAt)}–${hora.format(ventana.endsAt)} · ${asignacion.flight.number}`,
        posible: true
      };
    }),
    ...chapelco.map((turno): Ocupacion => ({
      clave: `chapelco:${turno.id}`,
      vehicleIds: [turno.vehicleId],
      driverIds: turno.driverId ? [turno.driverId] : [],
      desde: inicio,
      hasta: new Date(inicio.getTime() + 86_400_000),
      etiqueta: "Chapelco, todo el día",
      posible: true
    }))
  ];
}
