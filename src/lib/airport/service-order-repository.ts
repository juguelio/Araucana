import { privateStopsSchema } from "./private-transfer";
import { prisma } from "@/lib/db/prisma";
import { butacasParaAeropuerto, rangoDelDia } from "./booking";
import type { ServiceOrderReservationInput } from "./service-order";

/**
 * Reservas de aeropuerto de un día, con lo que necesita la orden de servicio del chofer.
 *
 * El día se busca por `AirportReservationDetails.serviceDate` (la fecha del servicio que eligió el
 * pasajero), no por `createdAt`: la hoja es de las reservas que viajan ese día, sin importar cuándo
 * se cargaron. Las canceladas quedan afuera —no se le entregan al chofer— pero las que están con el
 * pago pendiente sí entran: el chofer cobra contra esa hoja.
 */
/**
 * El vuelo y los que hace la misma camioneta en la misma vuelta (`pickupGroupId`): pedir la hoja de
 * cualquiera de ellos trae la orden de todos juntos (panel, Excel y link del chofer).
 */
export async function vuelosDelGrupo(flightId: string): Promise<string[]> {
  const vuelo = await prisma.flight.findUnique({ where: { id: flightId }, select: { pickupGroupId: true } });
  if (!vuelo?.pickupGroupId) return [flightId];
  const grupo = await prisma.flight.findMany({ where: { pickupGroupId: vuelo.pickupGroupId }, select: { id: true } });
  return [...new Set([flightId, ...grupo.map((miembro) => miembro.id)])];
}

export async function getAirportServiceOrderReservations(
  date: string,
  flightId?: string | null,
  { soloVuelosOperativos = false } = {}
): Promise<ServiceOrderReservationInput[]> {
  const { desde, hasta } = rangoDelDia(date);
  const flightIds = flightId ? await vuelosDelGrupo(flightId) : null;

  const reservas = await prisma.reservation.findMany({
    where: {
      bookingMode: "AIRPORT",
      status: { not: "CANCELLED" },
      airportDetails: {
        is: {
          serviceDate: { gte: desde, lt: hasta },
          ...(flightIds ? { flightId: { in: flightIds } } : {}),
          ...(soloVuelosOperativos ? { flight: { is: { status: { notIn: ["CANCELLED", "DIVERTED"] } } } } : {})
        }
      }
    },
    orderBy: [{ createdAt: "asc" }],
    include: {
      passenger: true,
      payment: { select: { status: true, method: true } },
      airportDetails: {
        include: {
          flight: {
            select: {
              id: true,
              number: true,
              airline: true,
              direction: true,
              scheduledAt: true,
              estimatedAt: true,
              pickupStartInitialAt: true,
              pickupStartOverrideAt: true,
              pickupGroupId: true,
              // Las naves del vuelo: con dos o más, la orden se parte por nave.
              assignments: {
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                select: {
                  id: true,
                  privateReservationId: true,
                  vehicle: { select: { id: true, name: true, _count: { select: { seats: true } } } },
                  driver: { select: { id: true, name: true, email: true } }
                }
              }
            }
          }
        }
      }
    }
  });

  return reservas.flatMap((reserva) => {
    const detalle = reserva.airportDetails;
    if (!detalle) return [];

    return [
      {
        code: reserva.code,
        privateOrderId: detalle.isPrivate ? detalle.id : null,
        privateStops: detalle.isPrivate ? privateStopsSchema.parse(detalle.privateStops) : undefined,
        // Quién derivó la venta (#109): lo carga el panel y el chofer lo lee en su hoja.
        referredBy: reserva.referredBy,
        totalCents: reserva.totalCents,
        currency: reserva.currency,
        passengerCount: reserva.passengerCount,
        paymentStatus: reserva.payment?.status ?? null,
        paymentMethod: reserva.payment?.method ?? null,
        direction: detalle.direction,
        flightNumber: detalle.flightNumber,
        pickupName: detalle.pickupName,
        pickupAddress: detalle.pickupAddress,
        pickupNotes: detalle.pickupNotes,
        pickupLatitude: detalle.pickupLatitude,
        pickupLongitude: detalle.pickupLongitude,
        assignmentId: detalle.assignmentId,
        routePosition: detalle.routePosition,
        passenger: {
          firstName: reserva.passenger.firstName,
          lastName: reserva.passenger.lastName,
          phone: reserva.passenger.phone,
          documentType: reserva.passenger.documentType,
          documentId: reserva.passenger.documentId
        },
        flight: detalle.flight
          ? {
              id: detalle.flight.id,
              number: detalle.flight.number,
              airline: detalle.flight.airline,
              direction: detalle.flight.direction,
              scheduledAt: detalle.flight.scheduledAt,
              estimatedAt: detalle.flight.estimatedAt,
              pickupStartInitialAt: detalle.flight.pickupStartInitialAt,
              pickupStartOverrideAt: detalle.flight.pickupStartOverrideAt,
              pickupGroupId: detalle.flight.pickupGroupId,
              vehicles: detalle.flight.assignments.filter(a => detalle.isPrivate ? a.privateReservationId === reserva.id : !a.privateReservationId).map((asignacion) => ({
                assignmentId: asignacion.id,
                vehicleId: asignacion.vehicle.id,
                name: asignacion.vehicle.name,
                // Lo que la nave vende para el aeropuerto: las chicas dejan 4 butacas para el equipaje.
                seats: butacasParaAeropuerto(asignacion.vehicle._count.seats),
                driver: asignacion.driver ? (asignacion.driver.name ?? asignacion.driver.email) : null,
                driverId: asignacion.driver?.id ?? null
              }))
            }
          : null
      }
    ];
  });
}
