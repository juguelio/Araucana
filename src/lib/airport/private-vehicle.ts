import type { Flight, Prisma } from "@prisma/client";
import { BookingError } from "@/lib/booking/repository";
import { lockFleet, specialConflicts } from "@/lib/special-trips/conflicts";
import { butacasParaAeropuerto } from "./capacity";
import { airportServiceWindow } from "./service-window";

type FlightRun = Pick<Flight, "id" | "pickupGroupId" | "scheduledAt" | "estimatedAt" | "pickupStartOverrideAt" | "direction">;

/** Se verifica bajo el bloqueo de la nave, antes de asignarla a otro traslado. */
export async function airportVehicleBusy(tx: Prisma.TransactionClient, vehicleId: string, flights: FlightRun[], privateBooking: boolean) {
  const assignments = await tx.airportVehicleAssignment.findMany({
    where: { vehicleId, ...(privateBooking ? {} : { privateReservationId: { not: null } }), flight: { status: { notIn: ["CANCELLED", "DIVERTED"] } } },
    select: { flight: { select: { id: true, pickupGroupId: true, direction: true, scheduledAt: true, estimatedAt: true, pickupStartOverrideAt: true } } }
  });
  return assignments.some(({ flight }) => {
    const busy = airportServiceWindow(flight);
    return flights.some(run => {
      if (run.id === flight.id || (run.pickupGroupId && run.pickupGroupId === flight.pickupGroupId)) return true;
      const window = airportServiceWindow(run);
      return busy.startsAt < window.endsAt && busy.endsAt > window.startsAt;
    });
  });
}

export async function assignPrivateVehicle(tx: Prisma.TransactionClient, reservationId: string, flight: FlightRun, minimumSeats: number, vehicleId: string, driverId: string | null = null, assignmentId?: string) {
  await lockFleet(tx, [vehicleId]);
  const vehicle = await tx.vehicle.findFirst({
    where: { id: vehicleId, isActive: true, kind: { not: "UTILITARIO" } },
    select: { _count: { select: { seats: true } } }
  });
  if (!vehicle || butacasParaAeropuerto(vehicle._count.seats) < minimumSeats) {
    throw new BookingError("PRIVATE_VEHICLE_UNAVAILABLE", `Elegí una nave activa con al menos ${minimumSeats} ${minimumSeats === 1 ? "lugar" : "lugares"} para aeropuerto.`);
  }
  if (await airportVehicleBusy(tx, vehicleId, [flight], true) ||
      (await specialConflicts(tx, { vehicleId, ...airportServiceWindow(flight) })).length) {
    throw new BookingError("PRIVATE_VEHICLE_UNAVAILABLE", "La nave ya está asignada a otro servicio. Elegí otra o dejá la asignación pendiente.");
  }
  if (assignmentId) {
    return tx.airportVehicleAssignment.update({
      where: { id: assignmentId, privateReservationId: reservationId, flightId: flight.id },
      data: { vehicleId, driverId }
    });
  }
  return tx.airportVehicleAssignment.create({ data: { vehicleId, driverId, flightId: flight.id, privateReservationId: reservationId } });
}
