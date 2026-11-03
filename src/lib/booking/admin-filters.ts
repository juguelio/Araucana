import type { Prisma } from "@prisma/client";
import { z } from "zod";

export const adminReservationFiltersSchema = z.object({
  code: z.string().trim().max(100).optional(),
  route: z.string().trim().max(100).optional(),
  scheduleId: z.string().trim().max(100).optional(),
  date: z.union([z.literal(""), z.iso.date()]).optional()
});
export type AdminReservationFilters = z.infer<typeof adminReservationFiltersSchema>;

// The date is the travel day, not the date on which the reservation was created.
export function adminReservationWhere(input: AdminReservationFilters): Prisma.ReservationWhereInput {
  const filters = adminReservationFiltersSchema.parse(input);
  const AND: Prisma.ReservationWhereInput[] = [];
  if (filters.code) AND.push({ code: { contains: filters.code, mode: "insensitive" } });
  if (filters.scheduleId) AND.push({ scheduleId: filters.scheduleId });
  if (filters.route) {
    const route: Prisma.TravelRouteWhereInput = { OR: ["from", "to", "slug"].map((field) => ({
      [field]: { contains: filters.route, mode: "insensitive" }
    })) };
    AND.push({ OR: [{ route: { is: route } }, { schedule: { is: { route: { is: route } } } }] });
  }
  if (filters.date) {
    const gte = new Date(`${filters.date}T00:00:00-03:00`);
    const lt = new Date(gte.getTime() + 86400000);
    // Chapelco stores a calendar date at UTC midnight; AIRPORT stores Argentine midnight.
    AND.push({ OR: [
      { schedule: { is: { departureAt: { gte, lt } } } },
      { airportDetails: { is: { serviceDate: { gte, lt } } } },
      { chapelcoDetails: { is: { serviceDate: new Date(`${filters.date}T00:00:00Z`) } } }
    ] });
  }
  return AND.length ? { AND } : {};
}
