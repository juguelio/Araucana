import { airportServiceWindow } from "@/lib/airport/service-window";
import { prisma } from "@/lib/db/prisma";
import type { ServicioDelDia } from "./tablero-choferes";

const hora = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Salta" });
const lugar = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim() === "san martin de los andes" ? "San Martín" : texto;

/**
 * Todos los servicios con nave de un día (YYYY-MM-DD, Argentina), uno por nave y servicio: salidas
 * (la nave principal y cada una sumada), combis de aeropuerto, naves de viajes especiales y turnos de
 * Chapelco. Cada uno con su chofer (o sin chofer) y el tramo en que la nave está ocupada.
 */
export async function cargarServiciosDelDia(dia: string): Promise<ServicioDelDia[]> {
  const inicio = new Date(`${dia}T00:00:00-03:00`);
  const fin = new Date(inicio.getTime() + 86_400_000);
  const estadoActivo = { notIn: ["CANCELLED", "CANCELED", "CLOSED"] };

  const [salidas, vuelos, viajes, chapelco] = await Promise.all([
    prisma.schedule.findMany({
      where: { departureAt: { gte: inicio, lt: fin }, status: estadoActivo },
      select: {
        id: true, routeId: true, departureAt: true, arrivalAt: true, vehicleId: true, driverId: true,
        route: { select: { from: true, to: true } },
        extraUnits: { select: { id: true, vehicleId: true, driverId: true } }
      }
    }),
    prisma.airportVehicleAssignment.findMany({
      where: {
        flight: {
          status: { notIn: ["CANCELLED", "DIVERTED"] },
          OR: [{ scheduledAt: { gte: inicio, lt: fin } }, { estimatedAt: { gte: inicio, lt: fin } }]
        }
      },
      select: {
        id: true, vehicleId: true, driverId: true, flightId: true,
        flight: { select: { number: true, direction: true, scheduledAt: true, estimatedAt: true, pickupStartInitialAt: true, pickupStartOverrideAt: true, status: true } }
      }
    }),
    prisma.specialTripAssignment.findMany({
      where: { startsAt: { lt: fin }, endsAt: { gt: inicio }, trip: { status: { not: "CANCELLED" } } },
      select: { id: true, tripId: true, vehicleId: true, driverId: true, startsAt: true, endsAt: true, trip: { select: { client: true } } }
    }),
    prisma.chapelcoVehicleDuty.findMany({
      where: { status: "ACTIVE", operationDay: { serviceDate: new Date(`${dia}T00:00:00Z`), status: { not: "CANCELLED" } } },
      select: { id: true, vehicleId: true, driverId: true }
    })
  ]);

  const servicios: ServicioDelDia[] = [];
  for (const salida of salidas) {
    const titulo = `${lugar(salida.route.from)} → ${lugar(salida.route.to)}`;
    const href = `/admin/servicio-publico?vista=dia&fecha=${dia}`;
    servicios.push({
      clave: `salida:${salida.id}`, area: "SERVICIO_PUBLICO", vehicleId: salida.vehicleId, driverId: salida.driverId,
      desde: salida.departureAt, hasta: salida.arrivalAt, titulo, href, asignableDesdeChoferes: true
    });
    for (const unidad of salida.extraUnits) {
      servicios.push({
        clave: `unidad:${unidad.id}`, area: "SERVICIO_PUBLICO", vehicleId: unidad.vehicleId, driverId: unidad.driverId,
        desde: salida.departureAt, hasta: salida.arrivalAt, titulo: `${titulo} (nave sumada)`, href, asignableDesdeChoferes: true
      });
    }
  }
  for (const asignacion of vuelos) {
    const ventana = airportServiceWindow({ ...asignacion.flight, status: asignacion.flight.status ?? undefined });
    servicios.push({
      clave: `vuelo:${asignacion.id}`, area: "AEROPUERTO", vehicleId: asignacion.vehicleId, driverId: asignacion.driverId,
      desde: ventana.startsAt, hasta: ventana.endsAt,
      titulo: `${asignacion.flight.direction === "ARRIVAL" ? "Arribo" : "Partida"} ${asignacion.flight.number} (${hora.format(asignacion.flight.estimatedAt ?? asignacion.flight.scheduledAt)})`,
      href: `/admin/aeropuerto?date=${dia}#vuelo-${asignacion.flightId}`,
      asignableDesdeChoferes: true
    });
  }
  for (const viaje of viajes) {
    servicios.push({
      clave: `viaje:${viaje.id}`, area: "VIAJE_ESPECIAL", vehicleId: viaje.vehicleId, driverId: viaje.driverId,
      desde: viaje.startsAt, hasta: viaje.endsAt, titulo: viaje.trip.client, href: `/admin/viajes-especiales/${viaje.tripId}`,
      asignableDesdeChoferes: true
    });
  }
  for (const turno of chapelco) {
    servicios.push({
      clave: `chapelco:${turno.id}`, area: "CHAPELCO", vehicleId: turno.vehicleId, driverId: turno.driverId,
      desde: new Date(`${dia}T08:00:00-03:00`), hasta: new Date(`${dia}T18:00:00-03:00`), titulo: "Chapelco",
      href: `/admin/chapelco?date=${dia}`, asignableDesdeChoferes: false
    });
  }
  return servicios;
}
