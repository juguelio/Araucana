import { prisma } from "@/lib/db/prisma";
import { rangoDelDia } from "./booking";
import type { ServiceOrderReservationInput } from "./service-order";

/**
 * Reservas de aeropuerto de un día, con lo que necesita la orden de servicio del chofer.
 *
 * El día se busca por `AirportReservationDetails.serviceDate` (la fecha del servicio que eligió el
 * pasajero), no por `createdAt`: la hoja es de las reservas que viajan ese día, sin importar cuándo
 * se cargaron. Las canceladas quedan afuera —no se le entregan al chofer— pero las que están con el
 * pago pendiente sí entran: el chofer cobra contra esa hoja.
 */
export async function getAirportServiceOrderReservations(
  date: string
): Promise<ServiceOrderReservationInput[]> {
  const { desde, hasta } = rangoDelDia(date);

  const reservas = await prisma.reservation.findMany({
    where: {
      bookingMode: "AIRPORT",
      status: { not: "CANCELLED" },
      airportDetails: { is: { serviceDate: { gte: desde, lt: hasta } } }
    },
    orderBy: [{ createdAt: "asc" }],
    include: {
      passenger: true,
      payment: { select: { status: true } },
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
              pickupStartOverrideAt: true
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
        totalCents: reserva.totalCents,
        currency: reserva.currency,
        passengerCount: reserva.passengerCount,
        paymentStatus: reserva.payment?.status ?? null,
        direction: detalle.direction,
        flightNumber: detalle.flightNumber,
        pickupName: detalle.pickupName,
        pickupAddress: detalle.pickupAddress,
        pickupNotes: detalle.pickupNotes,
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
              pickupStartOverrideAt: detalle.flight.pickupStartOverrideAt
            }
          : null
      }
    ];
  });
}
