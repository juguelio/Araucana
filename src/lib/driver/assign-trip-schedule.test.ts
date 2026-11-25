import type { Prisma } from "@prisma/client";
import { beforeEach, expect, it, vi } from "vitest";
import type { AssignTripInput } from "./assign-trip-types";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), find: vi.fn(), save: vi.fn(), fleet: vi.fn(), drivers: vi.fn(), concessions: vi.fn(),
  audit: vi.fn(), acceptance: vi.fn(), capacity: vi.fn()
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: { schedule: { findMany: mocks.list } } }));
vi.mock("@/lib/booking/schedule-unit-service", () => ({ primaryVehicleProblem: mocks.capacity }));
vi.mock("@/lib/audit/schedule", () => ({ recordScheduleAudit: mocks.audit }));
vi.mock("./school-trip-conflicts", () => ({ schoolTripConflicts: mocks.concessions }));
vi.mock("@/lib/special-trips/conflicts", async (original) => ({
  ...await original<typeof import("@/lib/special-trips/conflicts")>(),
  fleetConflicts: mocks.fleet, driverConflicts: mocks.drivers, recordAcceptance: mocks.acceptance
}));
import { assignScheduleTrip, listPendingScheduleTrips } from "./assign-trip-schedule";

const input: AssignTripInput = {
  kind: "schedule", id: "s", day: "2026-11-25", driverId: "d", vehicleId: "v", actor: { id: "a", role: "ADMIN" }, confirmation: ""
};
const schedule = { id: "s", vehicleId: null, departureAt: new Date("2026-11-25T08:00:00-03:00"),
  arrivalAt: new Date("2026-11-25T09:30:00-03:00"), route: { from: "SMA", to: "Traful", via: "Ruta 40" } };
const tx = { schedule: { findFirst: mocks.find, updateMany: mocks.save } } as unknown as Prisma.TransactionClient;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([schedule]);
  mocks.find.mockResolvedValue(schedule);
  mocks.save.mockResolvedValue({ count: 1 });
  mocks.fleet.mockResolvedValue([]);
  mocks.drivers.mockResolvedValue([]);
  mocks.concessions.mockResolvedValue([]);
});

it("lista horarios de salidas sin flota completa y aplica el mismo criterio al guardar", async () => {
  expect(await listPendingScheduleTrips(input.day)).toMatchObject([
    { id: "s", kind: "schedule", title: "SMA → Traful", detail: "08:00–09:30 · Ruta 40" }
  ]);
  const { where } = mocks.list.mock.calls[0][0];
  expect(where).toMatchObject({ route: { isActive: true }, vehicleId: null, extraUnits: { none: {} }, departureAt: {
    gte: new Date("2026-11-25T03:00:00Z"), lt: new Date("2026-11-26T03:00:00Z")
  } });
  expect(await assignScheduleTrip(tx, input)).toEqual({ saved: true });
  expect(mocks.save).toHaveBeenCalledWith({ where: { id: "s", ...where }, data: { vehicleId: "v", driverId: "d" } });
  expect(mocks.audit).toHaveBeenCalledOnce();
});

it("incluye las salidas futuras sin tope y usa su fecha argentina para asignarlas", async () => {
  mocks.list.mockResolvedValue([{ ...schedule,
    departureAt: new Date("2027-01-10T02:30:00Z"), arrivalAt: new Date("2027-01-10T04:00:00Z")
  }]);
  const [trip] = await listPendingScheduleTrips(input.day, true);
  expect(trip).toMatchObject({ id: "s", day: "2027-01-09", detail: "23:30–01:00 · Ruta 40" });
  expect(mocks.list.mock.calls[0][0].where.departureAt).toEqual({ gte: new Date("2026-11-25T03:00:00Z") });

  await assignScheduleTrip(tx, { ...input, day: trip.day });
  expect(mocks.find.mock.calls[0][0].where.departureAt).toEqual({
    gte: new Date("2027-01-09T03:00:00Z"), lt: new Date("2027-01-10T03:00:00Z")
  });
});

it("respeta una asignación simultánea sin sobrescribirla ni auditarla", async () => {
  mocks.save.mockResolvedValue({ count: 0 });
  expect(await assignScheduleTrip(tx, input)).toHaveProperty("error");
  expect(mocks.audit).not.toHaveBeenCalled();
});

it("rechaza la superposición de chofer y pide confirmación ante un posible cruce", async () => {
  mocks.drivers.mockResolvedValueOnce([{ id: "d1", subject: "driver", label: "Otra salida", possible: false }]);
  expect(await assignScheduleTrip(tx, input)).toHaveProperty("error");
  mocks.concessions.mockResolvedValue([{ id: "school", label: "Escolar", possible: true }]);
  const warning = await assignScheduleTrip(tx, input);
  expect(warning).toHaveProperty("confirmation");
  expect(mocks.save).not.toHaveBeenCalled();
  if (!("confirmation" in warning)) throw new Error("Se esperaba el aviso de superposición");
  expect(await assignScheduleTrip(tx, { ...input, confirmation: warning.confirmation })).toEqual({ saved: true });
});

it("conserva el cupo necesario cuando la salida tiene reservas", async () => {
  mocks.capacity.mockResolvedValue("No entran los pasajeros reservados.");
  expect(await assignScheduleTrip(tx, input)).toEqual({ error: "No entran los pasajeros reservados." });
  expect(mocks.save).not.toHaveBeenCalled();
});
