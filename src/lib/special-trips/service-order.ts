import { prisma } from "@/lib/db/prisma";
import { legSchema } from "./data";

export async function getSpecialTripOrder(id: string) {
  const trip = await prisma.specialTrip.findUnique({
    where: { id },
    select: {
      id: true, serviceDate: true, endDate: true, client: true, passengers: true, status: true,
      contact: true, contactName: true, contactPhone: true, legs: true, destinationSearch: true, notes: true,
      assignments: {
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        select: {
          id: true, startsAt: true, endsAt: true,
          vehicle: { select: { name: true, licensePlate: true, internalNumber: true, owner: true } },
          driver: { select: { name: true, email: true } }
        }
      }
    }
  });
  if (!trip) return null;
  const legs = Array.isArray(trip.legs) ? trip.legs.flatMap(value => {
    const parsed = legSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  }) : [];
  return { ...trip, legs };
}

export type SpecialTripOrder = NonNullable<Awaited<ReturnType<typeof getSpecialTripOrder>>>;
