"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { BookingError } from "@/lib/booking/repository";
import { recordEntityAudit } from "@/lib/audit/entity";
import { privateStopsSchema, privatePassengerCount, privateDestination, type PrivateStop } from "@/lib/airport/private-transfer";
import { assignPrivateVehicle } from "@/lib/airport/private-vehicle";
import { butacasParaAeropuerto } from "@/lib/airport/capacity";

export async function updatePrivateTransfer(code: string, stops: PrivateStop[], vehicleId: string) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const parsed = z.object({ stops: privateStopsSchema, vehicleId: z.string() }).safeParse({ stops, vehicleId });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const passengerCount = privatePassengerCount(parsed.data.stops);
  if (passengerCount > 24) return { error: "Máximo 24 pasajeros por reserva." };
  try {
    await prisma.$transaction(async tx => {
      const reservation = await tx.reservation.findUnique({ where: { code }, include: {
        airportDetails: { include: { flight: true } }, privateAirportVehicle: { include: { vehicle: { include: { _count: { select: { seats: true } } } } } }
      } });
      const details = reservation?.airportDetails;
      if (!reservation || !details?.isPrivate || !details.flight || reservation.status === "CANCELLED") {
        throw new BookingError("RESERVATION_LOCKED", "El traslado privado ya no está disponible para editar.");
      }
      const assigned = reservation.privateAirportVehicle;
      if (vehicleId && vehicleId === assigned?.vehicleId) {
        if (butacasParaAeropuerto(assigned.vehicle._count.seats) < passengerCount) throw new BookingError("CAPACITY_FULL", "La nave no tiene capacidad para todo el grupo.");
      } else {
        if (assigned) await tx.airportVehicleAssignment.delete({ where: { id: assigned.id } });
        if (vehicleId) await assignPrivateVehicle(tx, reservation.id, details.flight, passengerCount, vehicleId);
      }
      if (passengerCount <= reservation.halfFareCount + reservation.freeFareCount) throw new BookingError("INVALID_PASSENGER_COUNT", "Revisá las cantidades de adultos y menores del grupo.");
      const destination = privateDestination(parsed.data.stops);
      await tx.reservation.update({ where: { id: reservation.id }, data: { passengerCount, airportDetails: { update: { privateStops: parsed.data.stops, pickupAddress: destination } } } });
      await recordEntityAudit(tx, { actor, entity: "RESERVATION", entityId: reservation.id, entityLabel: reservation.shortCode,
        action: "UPDATE", summary: "Traslado privado actualizado.", before: { paradas: details.pickupAddress, nave: assigned?.vehicleId ?? null }, after: { paradas: destination, nave: vehicleId || null } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return { error: error instanceof BookingError ? error.message : "No se pudo guardar. Revisá la disponibilidad de la nave y volvé a intentar." };
  }
  revalidatePath(`/admin/reservas/${code}`);
  revalidatePath("/admin/aeropuerto");
  revalidatePath("/admin/aeropuerto/orden-de-servicio/ver");
  return { ok: "Traslado privado actualizado." };
}
