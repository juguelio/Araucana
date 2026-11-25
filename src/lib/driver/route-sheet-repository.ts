import { prisma } from "@/lib/db/prisma";
import type { RouteSheetInput } from "./route-sheet";

/**
 * Lo que necesita la planilla del chofer de una salida (issue #136), ya resuelto desde la base.
 *
 * Las canceladas no entran —el chofer no lleva a quien no viaja—; las que tienen el pago pendiente
 * sí, porque se cobra contra esa hoja, igual que en la orden de servicio del aeropuerto.
 */
export async function getRouteSheetInput(scheduleId: string): Promise<RouteSheetInput | null> {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true,
      departureAt: true,
      arrivalAt: true,
      status: true,
      driver: { select: { name: true, email: true } },
      route: { select: { from: true, to: true, via: true, stops: true } },
      vehicle: { select: { name: true, licensePlate: true } },
      extraUnits: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { vehicle: { select: { name: true, licensePlate: true } } } },
      reservations: {
        where: { status: { not: "CANCELLED" } },
        orderBy: [{ dropoffStop: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          passengerCount: true,
          boardingStop: true,
          dropoffStop: true,
          referredBy: true,
          totalCents: true,
          currency: true,
          ticket: { select: { code: true } },
          payment: { select: { status: true } },
          passenger: {
            select: {
              firstName: true,
              lastName: true,
              documentType: true,
              documentId: true,
              phone: true,
              email: true
            }
          }
        }
      }
    }
  });

  if (!schedule) return null;

  return {
    scheduleId: schedule.id,
    departureAt: schedule.departureAt,
    arrivalAt: schedule.arrivalAt,
    status: schedule.status,
    driver: schedule.driver,
    route: schedule.route,
    // Con varias naves, la planilla las nombra todas («Combi 243 (AB123CD) + Sprinter 196»).
    vehicle: schedule.extraUnits.length
      ? {
        name: [schedule.vehicle, ...schedule.extraUnits.map((unit) => unit.vehicle)]
          .map((vehicle) => (vehicle.licensePlate ? `${vehicle.name} (${vehicle.licensePlate})` : vehicle.name))
          .join(" + "),
        licensePlate: null
      }
      : schedule.vehicle,
    reservations: schedule.reservations.map((reservation) => ({
      id: reservation.id,
      ticketCode: reservation.ticket?.code ?? null,
      passengerCount: reservation.passengerCount,
      boardingStop: reservation.boardingStop,
      dropoffStop: reservation.dropoffStop,
      referredBy: reservation.referredBy,
      totalCents: reservation.totalCents,
      currency: reservation.currency,
      paymentStatus: reservation.payment?.status ?? null,
      passenger: reservation.passenger
    }))
  };
}
