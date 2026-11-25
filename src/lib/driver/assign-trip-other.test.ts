import type { Prisma } from "@prisma/client";
import { beforeEach, expect, it, vi } from "vitest";
import { assignOtherTrip, listPendingOtherTrips } from "./assign-trip-other";
import type { AssignTripInput } from "./assign-trip-types";
import { emptyLeg } from "@/lib/special-trips/data";
import { schoolTripConflicts, schoolTripWindow } from "./school-trip-conflicts";

const db = vi.hoisted(() => ({
  specialTrip: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  specialTripAssignment: { create: vi.fn() },
  schoolRun: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  travelRoute: { findMany: vi.fn(), findFirst: vi.fn() },
  seat: { count: vi.fn() },
  chapelcoOperationDay: { upsert: vi.fn() },
  chapelcoVehicleDuty: { findUnique: vi.fn(), upsert: vi.fn() }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/special-trips/conflicts", async (previous) => ({
  ...await previous<typeof import("@/lib/special-trips/conflicts")>(),
  fleetConflicts: vi.fn(async () => []), driverConflicts: vi.fn(async () => []), recordAcceptance: vi.fn()
}));
const tx = db as unknown as Prisma.TransactionClient;
const input: AssignTripInput = { kind: "school", id: "run", day: "2026-11-26", vehicleId: "v", driverId: "d", actor: { id: "a", role: "ADMIN" }, confirmation: "" };
const serviceDate = new Date("2026-11-26T00:00:00Z");
const school = { id: "run", serviceDate, routeName: "Personal de pista", kind: "personal-aeropuerto", shift: "07:30", driverId: "d", revision: 2 };
const special = { id: "trip", client: "Pehuén", destinationSearch: "Villa La Angostura", legs: [],
  serviceDate: new Date("2026-11-25T00:00:00Z"), endDate: new Date("2026-11-28T00:00:00Z"), updatedAt: new Date() };
beforeEach(() => {
  vi.clearAllMocks();
  db.schoolRun.findMany.mockResolvedValue([]);
  db.schoolRun.findFirst.mockResolvedValue(school);
  db.schoolRun.updateMany.mockResolvedValue({ count: 1 });
});

it("incluye todos los tipos de concesión, los especiales en curso y el día de Chapelco pendientes", async () => {
  db.schoolRun.findMany.mockResolvedValue([{ ...school, driver: { name: "Ana", email: "a@test" } }]);
  db.specialTrip.findMany.mockResolvedValue([special]);
  db.travelRoute.findMany.mockResolvedValue([{ id: "ski", from: "San Martín", to: "Cerro", chapelcoOperationDays: [], directReservations: [{ chapelcoDetails: { serviceDate, ascentSlot: "08:30" } }] }]);
  expect(await listPendingOtherTrips(input.day)).toEqual([
    expect.objectContaining({ kind: "special", title: "Pehuén" }),
    expect.objectContaining({ kind: "school", detail: "Personal aeropuerto · 07:30 · Chofer actual: Ana" }),
    expect.objectContaining({ kind: "chapelco", detail: "Primer ascenso 08:30" })
  ]);
  expect(db.schoolRun.findMany.mock.calls[0][0].where).toEqual({ serviceDate, vehicleId: null });
  expect(db.specialTrip.findMany.mock.calls[0][0].where).toMatchObject({ assignments: { none: {} }, status: { in: ["PENDING", "CONFIRMED"] } });
  const chapelco = db.travelRoute.findMany.mock.calls[0][0].select;
  expect(chapelco.directReservations.where.chapelcoDetails.serviceDate).toEqual(serviceDate);
  expect(chapelco.chapelcoOperationDays.where.serviceDate).toEqual(serviceDate);
});

it("guarda sólo el turno elegido y comprueba que continúe sin nave", async () => {
  expect(await assignOtherTrip(tx, input)).toEqual({ saved: true });
  expect(db.schoolRun.updateMany).toHaveBeenCalledWith({
    where: { id: "run", revision: 2, vehicleId: null }, data: { driverId: "d", vehicleId: "v", revision: { increment: 1 } }
  });
  db.schoolRun.updateMany.mockResolvedValue({ count: 0 });
  expect(await assignOtherTrip(tx, input)).toHaveProperty("error");
});

it("comprueba la ocupación del mismo chofer entre distintos tipos de concesión", async () => {
  db.schoolRun.findMany.mockResolvedValue([{ ...school, id: "otro", kind: "escuela", shift: "7.30", driverId: "d", vehicleId: "otra" }]);
  expect(await assignOtherTrip(tx, input)).toHaveProperty("error", expect.stringContaining("chofer"));
  expect(db.schoolRun.updateMany).not.toHaveBeenCalled();
});

it("sólo avisa del cruce con un turno nombrado, y permite confirmar esa asignación", async () => {
  db.schoolRun.findMany.mockResolvedValue([{ ...school, id: "tarde", shift: "Mañana", vehicleId: "v" }]);
  const first = await assignOtherTrip(tx, input);
  expect(first).toHaveProperty("conflicts.0.possible", true);
  expect(db.schoolRun.updateMany).not.toHaveBeenCalled();
  expect(await assignOtherTrip(tx, { ...input, confirmation: "confirmation" in first ? first.confirmation : "" })).toEqual({ saved: true });
});

it("respeta el retorno de un especial de varios días y la edición concurrente de su ficha", async () => {
  db.specialTrip.findFirst.mockResolvedValue(special);
  db.specialTrip.updateMany.mockResolvedValue({ count: 1 });
  const proposal: AssignTripInput = { ...input, kind: "special", id: special.id };
  expect(await assignOtherTrip(tx, proposal)).toEqual({ saved: true });
  expect(db.specialTripAssignment.create).toHaveBeenCalledWith({ data: { tripId: special.id, driverId: "d", vehicleId: "v",
    startsAt: new Date("2026-11-25T11:00:00Z"), endsAt: new Date("2026-11-28T23:00:00Z") } });
  db.specialTrip.updateMany.mockResolvedValue({ count: 0 });
  expect(await assignOtherTrip(tx, proposal)).toHaveProperty("error");
  expect(db.specialTripAssignment.create).toHaveBeenCalledTimes(1);
});

it("asigna la nave con su chofer y cupo en una operación nueva de Chapelco", async () => {
  db.travelRoute.findFirst.mockResolvedValue({ id: "ski" });
  db.seat.count.mockResolvedValue(19);
  db.chapelcoOperationDay.upsert.mockResolvedValue({ id: "day" });
  db.chapelcoVehicleDuty.findUnique.mockResolvedValue(null);
  db.chapelcoVehicleDuty.upsert.mockResolvedValue({ id: "duty" });
  expect(await assignOtherTrip(tx, { ...input, kind: "chapelco", id: "ski" })).toEqual({ saved: true });
  expect(db.chapelcoVehicleDuty.upsert.mock.calls[0][0].create).toMatchObject({ operationDayId: "day", vehicleId: "v", driverId: "d", capacity: 19 });
  db.travelRoute.findFirst.mockResolvedValue(null);
  expect(await assignOtherTrip(tx, { ...input, kind: "chapelco", id: "ski" })).toHaveProperty("error");
  expect(db.chapelcoVehicleDuty.upsert).toHaveBeenCalledTimes(1);
});

it("al cruzar otro servicio, un turno puntual sólo cuenta dentro de su ventana", async () => {
  db.schoolRun.findMany.mockResolvedValue([{ ...school, vehicleId: "otra" }]);
  const base = { driverId: "d", vehicleId: "v" };
  expect(await schoolTripConflicts(tx, { ...base, ...schoolTripWindow(input.day, "07:30")! })).toHaveLength(1);
  expect(await schoolTripConflicts(tx, { ...base, ...schoolTripWindow(input.day, "07:31")! })).toEqual([]);
  expect(schoolTripWindow(input.day, "Sin horario")).toBeNull();
});

it("usa los horarios indicados en el itinerario del especial para ocupar los recursos", async () => {
  const trip = { ...special, serviceDate, endDate: null, legs: [
    { ...emptyLeg, departure: "2026-11-26T05:15", arrival: "2026-11-26T07:40" }
  ] };
  db.specialTrip.findFirst.mockResolvedValue(trip);
  db.specialTrip.updateMany.mockResolvedValue({ count: 1 });
  expect(await assignOtherTrip(tx, { ...input, kind: "special", id: trip.id })).toEqual({ saved: true });
  expect(db.specialTripAssignment.create.mock.calls[0][0].data).toMatchObject({
    startsAt: new Date("2026-11-26T08:15:00Z"), endsAt: new Date("2026-11-26T10:40:00Z")
  });
});

it("lista por fecha cada turno y jornada futura, sin duplicar especiales en curso ni incluir días de Chapelco resueltos", async () => {
  const next = new Date("2026-11-28T00:00:00Z");
  const occupied = new Date("2026-11-29T00:00:00Z");
  const cancelled = new Date("2026-11-30T00:00:00Z");
  db.schoolRun.findMany.mockResolvedValue([{ ...school, serviceDate: next, driver: null }]);
  db.specialTrip.findMany.mockResolvedValue([special, { ...special, id: "futuro", serviceDate: next }]);
  const booking = (date: Date, slot: string) => ({ chapelcoDetails: { serviceDate: date, ascentSlot: slot } });
  db.travelRoute.findMany.mockResolvedValue([{ id: "ski", from: "Ciudad", to: "Cerro",
    directReservations: [booking(serviceDate, "10:30"), booking(serviceDate, "08:30"), booking(occupied, "08:30"), booking(cancelled, "12:00")],
    chapelcoOperationDays: [
      { serviceDate, status: "OPEN", _count: { vehicleDuties: 0 } },
      { serviceDate: next, status: "OPEN", _count: { vehicleDuties: 0 } },
      { serviceDate: occupied, status: "OPEN", _count: { vehicleDuties: 1 } },
      { serviceDate: cancelled, status: "CANCELLED", _count: { vehicleDuties: 0 } }
    ]
  }]);
  const rows = await listPendingOtherTrips(input.day, true);
  expect(rows.map(({ id, day }) => [id, day])).toEqual([
    ["trip", input.day], ["futuro", "2026-11-28"], ["run", "2026-11-28"], ["ski", input.day], ["ski", "2026-11-28"]
  ]);
  expect(rows[2].startsAt).toBe(+new Date("2026-11-28T07:30:00-03:00"));
  expect(rows[3].detail).toBe("Primer ascenso 08:30");
  expect(db.schoolRun.findMany.mock.calls[0][0].where).toMatchObject({ serviceDate: { gte: serviceDate } });
  expect(db.specialTrip.findMany.mock.calls[0][0].where.OR).toEqual([{ serviceDate: { gte: serviceDate } }, { endDate: { gte: serviceDate } }]);
  expect(db.travelRoute.findMany).toHaveBeenCalledTimes(1);
  expect(db.travelRoute.findMany.mock.calls[0][0].select.chapelcoOperationDays.where).toEqual({ serviceDate: { gte: serviceDate } });
});
