import { getAirportServiceOrder } from "@/lib/airport/service-order-data";
import { prisma } from "@/lib/db/prisma";
import { dayRange } from "@/lib/operations/day-board";

export async function listDriverServiceOrders(driverId: string, date: string) {
  const { from, to } = dayRange(date);
  const [{ blocks }, assignments] = await Promise.all([
    getAirportServiceOrder(date, null, { soloVuelosOperativos: true }),
    prisma.specialTripAssignment.findMany({
      where: {
        driverId,
        startsAt: { lt: to },
        endsAt: { gt: from },
        trip: { status: { not: "CANCELLED" } }
      },
      select: {
        id: true, startsAt: true, endsAt: true, vehicle: { select: { name: true } },
        trip: { select: {
          client: true, contactName: true, contactPhone: true, contact: true,
          passengers: true, notes: true, legs: true, destinationSearch: true
        } }
      }
    })
  ]);

  // El reparto de pasajeros se calcula para todas las naves antes de filtrar por chofer.
  const airport = blocks.filter((block) => block.vehicle?.driverId === driverId && block.passengers.length > 0)
    .map((block) => ({ type: "airport" as const, id: block.key, at: block.operationAt, block }));
  const special = assignments.map((assignment) => ({
    type: "special" as const, id: assignment.id, at: assignment.startsAt, assignment
  }));

  return [...airport, ...special].sort((a, b) => +a.at - +b.at || a.id.localeCompare(b.id));
}
