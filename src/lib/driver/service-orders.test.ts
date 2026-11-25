import { beforeEach, expect, it, vi } from "vitest";
import { buildServiceOrderBlocks, type ServiceOrderReservationInput } from "@/lib/airport/service-order";
import { getAirportServiceOrder } from "@/lib/airport/service-order-data";
import { prisma } from "@/lib/db/prisma";
import { driversWithServiceOrders, listDriverServiceOrders } from "./service-orders";
import { getRouteSheetInput } from "./route-sheet-repository";

vi.mock("@/lib/airport/service-order-data", () => ({ getAirportServiceOrder: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { schoolRun: { findMany: vi.fn() }, chapelcoVehicleDuty: { findMany: vi.fn() },
    driverServiceMark: { findMany: vi.fn() }, specialTripAssignment: { findMany: vi.fn() }, schedule: { findMany: vi.fn() } }
}));
vi.mock("./route-sheet-repository", () => ({ getRouteSheetInput: vi.fn() }));

const office = { enabled: false, label: "", address: "", point: null };
const departureAt = new Date("2026-11-24T14:30:00Z");
const schedule = {
  id: "s1", departureAt, arrivalAt: new Date("2026-11-24T16:30:00Z"), status: "OPEN",
  routeId: "r1", vehicleId: "v1", createdAt: departureAt, updatedAt: departureAt,
  driverId: "principal", vehicle: { name: "Combi principal" },
  extraUnits: [{ driverId: "adicional", vehicle: { name: "Combi adicional" } }]
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.schoolRun.findMany).mockResolvedValue([]);
  vi.mocked(prisma.chapelcoVehicleDuty.findMany).mockResolvedValue([]);
  vi.mocked(prisma.driverServiceMark.findMany).mockResolvedValue([]);
  vi.mocked(getAirportServiceOrder).mockResolvedValue({ blocks: [], oficina: office });
  vi.mocked(prisma.specialTripAssignment.findMany).mockResolvedValue([]);
  vi.mocked(prisma.schedule.findMany).mockResolvedValue([]);
});

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
  vi.mocked(getAirportServiceOrder).mockResolvedValue({ blocks, oficina: office });
  vi.mocked(prisma.specialTripAssignment.findMany).mockResolvedValue([{
    id: "especial", tripId: "t1", driverId: "c1", vehicleId: "v1",
    startsAt: new Date("2026-11-24T17:00:00Z"), endsAt: new Date("2026-11-25T23:00:00Z")
  }]);

  const orders = await listDriverServiceOrders("c1", "2026-11-24");

  expect(getAirportServiceOrder).toHaveBeenCalledWith("2026-11-24", null, { soloVuelosOperativos: true, incluirVacias: true });
  expect(prisma.specialTripAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      driverId: { in: ["c1"] }, startsAt: { lt: new Date("2026-11-25T03:00:00Z") },
      endsAt: { gt: new Date("2026-11-24T03:00:00Z") }, trip: { status: { not: "CANCELLED" } }
    }
  }));
  expect(orders.map((order) => order.type)).toEqual(["airport", "special"]);
  const [airportOrder] = orders;
  expect(airportOrder?.type === "airport" && airportOrder.block.passengers.map(({ code }) => code)).toEqual(["IN-PROPIO"]);
});


it("habilita la hoja sólo para asignaciones de hoy, incluida la nave adicional de una ruta", async () => {
  vi.mocked(prisma.schedule.findMany).mockResolvedValue([schedule]);
  vi.mocked(prisma.specialTripAssignment.findMany).mockResolvedValue([{
    id: "v1", tripId: "t1", driverId: "especial", vehicleId: "n1",
    startsAt: new Date("2026-11-23T15:00:00Z"), endsAt: new Date("2026-11-25T15:00:00Z")
  }]);
  const drivers = ["principal", "adicional", "especial", "sin-viajes"];

  expect(await driversWithServiceOrders(drivers, "2026-11-24")).toEqual(new Set(["principal", "adicional", "especial"]));
  const driverId = { in: drivers };
  expect(prisma.schedule.findMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    where: {
      departureAt: { gte: new Date("2026-11-24T03:00:00Z"), lt: new Date("2026-11-25T03:00:00Z") },
      status: { not: "CANCELLED" }, route: { bookingMode: "SEATED" },
      OR: [{ driverId }, { extraUnits: { some: { driverId } } }]
    }
  }));
  expect(getRouteSheetInput).not.toHaveBeenCalled();
});

it("imprime la salida de ruta del chofer adicional con su nave y el horario incluso sin reservas", async () => {
  vi.mocked(prisma.schedule.findMany).mockResolvedValue([schedule]);
  vi.mocked(getRouteSheetInput).mockResolvedValue({
    scheduleId: "s1", departureAt, arrivalAt: new Date("2026-11-24T16:30:00Z"), status: "OPEN",
    driver: { name: "Chofer adicional", email: "adicional@example.com" },
    route: { from: "San Martín", to: "Villa Traful", via: "", stops: [] },
    vehicle: { name: "Combi principal + Combi adicional", licensePlate: null }, reservations: []
  });

  expect(await listDriverServiceOrders("adicional", "2026-11-24")).toMatchObject([
    { type: "route", id: "s1", vehicles: ["Combi adicional"],
      sheet: { heading: expect.stringContaining("sale 11:30"), passengers: [] } }
  ]);
});

it("conserva la hoja del chofer que ya tiene salida aunque todavía esté pendiente la nave", async () => {
  const sinNave = { ...schedule, vehicle: null, vehicleId: null, extraUnits: [] };
  vi.mocked(prisma.schedule.findMany).mockResolvedValue([sinNave]);
  vi.mocked(getRouteSheetInput).mockResolvedValue({
    scheduleId: "s1", departureAt, arrivalAt: schedule.arrivalAt, status: "OPEN",
    driver: { name: "Chofer principal", email: "principal@example.com" },
    route: { from: "San Martín", to: "Villa Traful", via: "", stops: [] },
    vehicle: { name: "Sin nave", licensePlate: null }, reservations: []
  });
  expect(await listDriverServiceOrders("principal", "2026-11-24")).toMatchObject([
    { type: "route", id: "s1", vehicles: [], sheet: { vehicle: "Sin nave" } }
  ]);
});
