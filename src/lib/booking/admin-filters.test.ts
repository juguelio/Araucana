import { describe, expect, it } from "vitest";
import { adminReservationFiltersSchema, adminReservationWhere } from "./admin-filters";

describe("reservation search", () => {
  it("rejects invalid calendar days instead of silently searching all reservations", () => {
    expect(adminReservationFiltersSchema.safeParse({ date: "2026-02-30" }).success).toBe(false);
    expect(adminReservationFiltersSchema.safeParse({ date: "not-a-date" }).success).toBe(false);
  });
  it("combines filters and uses the travel day for all three booking modes", () => {
    const where = adminReservationWhere({ code: " arc-123 ", route: " SMA ", scheduleId: "departure", date: "2026-11-03" });
    expect(where.AND).toEqual([
      { code: { contains: "arc-123", mode: "insensitive" } },
      { scheduleId: "departure" },
      expect.objectContaining({ OR: expect.any(Array) }),
      { OR: [
        { schedule: { is: { departureAt: { gte: new Date("2026-11-03T03:00:00Z"), lt: new Date("2026-11-04T03:00:00Z") } } } },
        { airportDetails: { is: { serviceDate: { gte: new Date("2026-11-03T03:00:00Z"), lt: new Date("2026-11-04T03:00:00Z") } } } },
        { chapelcoDetails: { is: { serviceDate: new Date("2026-11-03T00:00:00Z") } } }
      ] }
    ]);
  });
});
