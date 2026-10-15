import { describe, expect, it, vi } from "vitest";
const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/prisma", () => ({ prisma: { schedule: { findMany } } }));
import { listDriverUpcomingSchedules } from "./schedules";

describe("driver schedule capacity", () => {
  it("subtracts people rather than reservation rows", async () => {
    findMany.mockResolvedValue([{
      id: "s", routeId: "r", route: { id: "r", slug: "r", from: "A", to: "B", via: "C", stops: [] },
      departureAt: new Date(), arrivalAt: new Date(), status: "OPEN",
      vehicle: { id: "v", name: "Vehicle", licensePlate: null, _count: { seats: 19 } },
      reservations: [{ id: "booking", ticket: { code: "TKT-2610-ABCDEFGH" }, seatNumber: null, passengerCount: 4, status: "PENDING_PAYMENT", payment: null, passenger: { firstName: "Test", lastName: "Only", phone: "123456", documentType: "DNI", documentId: "0000" } }]
    }]);
    const [schedule] = await listDriverUpcomingSchedules();
    expect(schedule).toMatchObject({ totalSeats: 19, availableSeats: 15, passengerCount: 4, reservationCount: 1 });
  });

  it("shows drivers the ticket code and never asks for the private reservation code", async () => {
    const [schedule] = await listDriverUpcomingSchedules();
    expect(schedule.passengers[0].code).toBe("TKT-2610-ABCDEFGH");
    const select = findMany.mock.calls.at(-1)?.[0]?.include?.reservations?.select;
    expect(select).not.toHaveProperty("code");
    expect(select).toHaveProperty("ticket");
  });
});
