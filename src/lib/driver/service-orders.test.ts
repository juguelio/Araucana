import { expect, it, vi } from "vitest";
import { buildServiceOrderBlocks, type ServiceOrderReservationInput } from "@/lib/airport/service-order";
import { getAirportServiceOrder } from "@/lib/airport/service-order-data";
import { prisma } from "@/lib/db/prisma";
import { listDriverServiceOrders } from "./service-orders";

vi.mock("@/lib/airport/service-order-data", () => ({ getAirportServiceOrder: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { specialTripAssignment: { findMany: vi.fn() } } }));

it("ordena juntos el IN y el viaje especial del chofer, conservando el reparto del vuelo por nave", async () => {
  const reservation: ServiceOrderReservationInput = {
    code: "IN-PROPIO", direction: "ARRIVAL", flightNumber: "AR1660", pickupName: null, pickupAddress: null, pickupNotes: null,
    totalCents: 0, currency: "ARS", passengerCount: 1, paymentStatus: null, assignmentId: "a1",
    passenger: { firstName: "Pasajero", lastName: "Uno", phone: "", documentType: "DNI", documentId: "1" },
    flight: {
      id: "f1", number: "AR1660", direction: "ARRIVAL", airline: null,
      scheduledAt: new Date("2026-11-24T13:00:00Z"), estimatedAt: null, pickupStartOverrideAt: null,
      vehicles: [
        { assignmentId: "a1", vehicleId: "v1", name: "Combi 1", seats: 6, driver: "Chofer uno", driverId: "c1" },
        { assignmentId: "a2", vehicleId: "v2", name: "Combi 2", seats: 6, driver: "Chofer dos", driverId: "c2" }
      ]
    }
  };
  const blocks = buildServiceOrderBlocks([
    reservation,
    { ...reservation, assignmentId: "a2", code: "IN-OTRA-NAVE" },
    { ...reservation, flight: null, code: "IN-SIN-CHOFER" }
  ]);
  vi.mocked(getAirportServiceOrder).mockResolvedValue({ blocks, oficina: { enabled: false, label: "", address: "", point: null } });
  vi.mocked(prisma.specialTripAssignment.findMany).mockResolvedValue([{
    id: "especial", tripId: "t1", driverId: "c1", vehicleId: "v1",
    startsAt: new Date("2026-11-24T17:00:00Z"), endsAt: new Date("2026-11-25T23:00:00Z")
  }]);

  const orders = await listDriverServiceOrders("c1", "2026-11-24");

  expect(getAirportServiceOrder).toHaveBeenCalledWith("2026-11-24", null, { soloVuelosOperativos: true });
  expect(prisma.specialTripAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      driverId: "c1", startsAt: { lt: new Date("2026-11-25T03:00:00Z") },
      endsAt: { gt: new Date("2026-11-24T03:00:00Z") }, trip: { status: { not: "CANCELLED" } }
    }
  }));
  expect(orders.map((order) => order.type)).toEqual(["airport", "special"]);
  const [airportOrder] = orders;
  expect(airportOrder?.type === "airport" && airportOrder.block.passengers.map(({ code }) => code)).toEqual(["IN-PROPIO"]);
});
