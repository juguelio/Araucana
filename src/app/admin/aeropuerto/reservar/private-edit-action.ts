"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { BookingError } from "@/lib/booking/repository";
import { recordEntityAudit } from "@/lib/audit/entity";
import { privateStopsSchema, privatePassengerCount, privateDestination, type PrivateStop } from "@/lib/airport/private-transfer";
import { assignPrivateVehicle } from "@/lib/airport/private-vehicle";

export async function updatePrivateTransfer(code: string, stops: PrivateStop[], change: { previous: string; next: string } | null) {
  const actor = await getCurrentReservationsUserOrRedirect();
  const parsed = z.object({ stops: privateStopsSchema, change: z.object({ previous: z.string(), next: z.string() }).nullable() }).safeParse({ stops, change });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const passengerCount = privatePassengerCount(parsed.data.stops);
  if (passengerCount > 24) return { error: "Máximo 24 pasajeros por reserva." };
  try {
    await prisma.$transaction(async tx => {
      const reservation = await tx.reservation.findUnique({ where: { code }, include: {
        airportDetails: { include: { flight: true } }, privateAirportVehicles: true
      } });
      const details = reservation?.airportDetails;
      if (!reservation || !details?.isPrivate || !details.flight || reservation.status === "CANCELLED") {
        throw new BookingError("RESERVATION_LOCKED", "El traslado privado ya no está disponible para editar.");
      }
      const assigned = reservation.privateAirportVehicles;
      if (change) {
        if (assigned.length > 1 || (assigned[0]?.vehicleId ?? "") !== change.previous) {
          throw new BookingError("RESERVATION_LOCKED", "Las naves cambiaron. Actualizá la reserva antes de guardar.");
        }
        if (change.next) {
          await assignPrivateVehicle(tx, reservation.id, details.flight, passengerCount, change.next, assigned[0]?.driverId, assigned[0]?.id);
        } else if (assigned[0]) {
          await tx.airportVehicleAssignment.delete({ where: { id: assigned[0].id } });
        }
      }
      if (passengerCount <= reservation.halfFareCount + reservation.freeFareCount) throw new BookingError("INVALID_PASSENGER_COUNT", "Revisá las cantidades de adultos y menores del grupo.");
      const destination = privateDestination(parsed.data.stops);
      await tx.reservation.update({ where: { id: reservation.id }, data: { passengerCount, airportDetails: { update: { privateStops: parsed.data.stops, pickupAddress: destination } } } });
      await recordEntityAudit(tx, { actor, entity: "RESERVATION", entityId: reservation.id, entityLabel: reservation.shortCode,
        action: "UPDATE", summary: "Traslado privado actualizado.", before: { paradas: details.pickupAddress, naves: assigned.map(a => a.vehicleId) }, after: { paradas: destination, naves: change ? [change.next].filter(Boolean) : assigned.map(a => a.vehicleId) } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return { error: error instanceof BookingError ? error.message : "No se pudo guardar. Revisá la disponibilidad de la nave y volvé a intentar." };
  }
  revalidatePath(`/admin/reservas/${code}`);
  revalidatePath("/admin/aeropuerto");
  revalidatePath("/admin/aeropuerto/orden-de-servicio/ver");
  return { ok: "Traslado privado actualizado." };
}
