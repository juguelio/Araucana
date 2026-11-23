import { prisma } from "@/lib/db/prisma";
import { recorridosDeNave } from "@/lib/vehicles/ficha";

const chofer = { select: { name: true, email: true } } as const;
const ruta = { select: { id: true, from: true, to: true } } as const;

/**
 * Todos los servicios de una nave, de las cuatro áreas. Se traen enteros: una unidad suma decenas o
 * pocos cientos de servicios por temporada, y la lista se ordena y pagina en memoria porque mezcla
 * tablas distintas.
 */
export async function cargarRecorridos(vehicleId: string) {
  const [salidas, unidadesExtra, viajesEspeciales, aeropuerto, chapelco] = await Promise.all([
    prisma.schedule.findMany({
      where: { vehicleId },
      select: {
        id: true, routeId: true, departureAt: true, arrivalAt: true, status: true,
        route: ruta, driver: chofer, _count: { select: { reservations: true } }
      }
    }),
    prisma.scheduleUnit.findMany({
      where: { vehicleId },
      select: {
        id: true, driver: chofer,
        schedule: { select: { id: true, routeId: true, departureAt: true, arrivalAt: true, status: true, route: ruta } }
      }
    }),
    prisma.specialTripAssignment.findMany({
      where: { vehicleId },
      select: {
        id: true, startsAt: true, endsAt: true, driver: chofer, coDriver: chofer,
        trip: { select: { id: true, client: true, status: true, passengers: true } }
      }
    }),
    prisma.airportVehicleAssignment.findMany({
      where: { vehicleId },
      select: {
        id: true, driver: chofer,
        flight: { select: { id: true, number: true, airline: true, origin: true, destination: true, direction: true, scheduledAt: true, status: true } }
      }
    }),
    prisma.chapelcoVehicleDuty.findMany({
      where: { vehicleId },
      select: {
        id: true, status: true, capacity: true, driver: chofer,
        operationDay: { select: { serviceDate: true, route: ruta } },
        _count: { select: { runs: true } }
      }
    })
  ]);
  return recorridosDeNave({ salidas, unidadesExtra, viajesEspeciales, aeropuerto, chapelco });
}
