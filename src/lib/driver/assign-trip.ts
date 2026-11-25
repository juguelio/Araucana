import { prisma } from "@/lib/db/prisma";
import { lockFleet } from "@/lib/special-trips/conflicts";
import { assignAirportTrip, listPendingAirportTrips } from "./assign-trip-airport";
import { assignOtherTrip, listPendingOtherTrips } from "./assign-trip-other";
import { assignScheduleTrip, listPendingScheduleTrips } from "./assign-trip-schedule";
import type { AssignTripInput, AssignTripResult } from "./assign-trip-types";

export async function listPendingTrips(day: string, upcoming = false) {
  const groups = await Promise.all([listPendingAirportTrips(day, upcoming), listPendingScheduleTrips(day, upcoming), listPendingOtherTrips(day, upcoming)]);
  return groups.flat().sort((a, b) => a.day.localeCompare(b.day) || a.startsAt - b.startsAt || a.title.localeCompare(b.title, "es") || a.id.localeCompare(b.id));
}

export async function assignPendingTrip(input: AssignTripInput): Promise<AssignTripResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockFleet(tx, [input.vehicleId]);
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.driverId} FOR NO KEY UPDATE`;
      const [driver, vehicle] = await Promise.all([
        tx.user.findFirst({ where: { id: input.driverId, role: "DRIVER", isActive: true }, select: { id: true } }),
        tx.vehicle.findFirst({ where: { id: input.vehicleId, isActive: true, kind: { not: "UTILITARIO" } }, select: { id: true } })
      ]);
      if (!driver) return { error: "Ese chofer ya no está activo." };
      if (!vehicle) return { error: "Elegí una nave de pasajeros activa." };

      switch (input.kind) {
        case "airport":
        case "private":
          return assignAirportTrip(tx, input);
        case "schedule":
          return assignScheduleTrip(tx, input);
        default:
          return assignOtherTrip(tx, input);
      }
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error &&
        (error.code === "P2034" || error.code === "P2002" || error.code === "P2025")) {
      return { error: "La disponibilidad cambió mientras elegías. Revisá los viajes y volvé a intentar." };
    }
    throw error;
  }
}
