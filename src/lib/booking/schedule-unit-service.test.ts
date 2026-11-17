import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  schedule: null as null | Record<string, unknown>,
  vehicles: {} as Record<string, { isActive: boolean; seats: number }>,
  createUnit: vi.fn(),
  updateUnit: vi.fn(),
  deleteUnit: vi.fn(),
  updateSchedule: vi.fn(),
  findUnit: vi.fn(),
  audit: vi.fn(),
  conflicts: vi.fn()
}));

const tx = vi.hoisted(() => ({
  schedule: { findUnique: async () => mocks.schedule, update: mocks.updateSchedule },
  scheduleUnit: { create: mocks.createUnit, update: mocks.updateUnit, delete: mocks.deleteUnit, findUnique: mocks.findUnit },
  vehicle: { findUnique: async ({ where }: { where: { id: string } }) => {
    const vehicle = mocks.vehicles[where.id];
    return vehicle ? { isActive: vehicle.isActive, _count: { seats: vehicle.seats } } : null;
  } }
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    ...tx,
    user: { findFirst: async () => ({ id: "d1" }) },
    $transaction: (run: (client: unknown) => unknown) => run(tx)
  }
}));
vi.mock("@/lib/audit/schedule", () => ({ recordScheduleAudit: mocks.audit }));
vi.mock("@/lib/special-trips/conflicts", () => ({
  lockFleet: vi.fn(),
  fleetConflicts: mocks.conflicts,
  recordAcceptance: vi.fn(),
  conflictKey: (conflicts: Array<{ id: string }>, proposal: unknown) => JSON.stringify([proposal, conflicts.map((c) => c.id)])
}));

import { addScheduleUnit, primaryVehicleProblem, removeScheduleUnit, updateScheduleUnit } from "./schedule-unit-service";

const actor = { id: "admin", name: "Admin", email: "admin@araucana.test", role: "ADMIN" };
const unit = (id: string, vehicleId: string, seats: number, isActive = true, driverId: string | null = null) =>
  ({ id, vehicleId, driverId, vehicle: { isActive, _count: { seats } } });

function salida(extraUnits: ReturnType<typeof unit>[], pasajeros: number[]) {
  return {
    id: "s1", routeId: "r1", vehicleId: "vA", driverId: "dA", status: "OPEN",
    departureAt: new Date("2026-11-18T10:00:00-03:00"), arrivalAt: new Date("2026-11-18T12:00:00-03:00"),
    route: { slug: "sma-traful" },
    vehicle: { _count: { seats: 19 } },
    extraUnits,
    reservations: pasajeros.map((passengerCount) => ({ passengerCount }))
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.vehicles = { vA: { isActive: true, seats: 19 }, vB: { isActive: true, seats: 15 }, vC: { isActive: true, seats: 4 }, vOff: { isActive: false, seats: 30 } };
  mocks.conflicts.mockResolvedValue([]);
});

describe("naves de una salida", () => {
  it("suma una nave y deja la auditoría con las naves de antes y de después", async () => {
    mocks.schedule = salida([], [10]);
    const result = await addScheduleUnit({ actor, scheduleId: "s1", vehicleId: "vB", driverId: "d1", confirmation: "" });
    expect(result).toMatchObject({ ok: true, summary: "Nave sumada a la salida." });
    expect(mocks.createUnit).toHaveBeenCalledWith({ data: { scheduleId: "s1", vehicleId: "vB", driverId: "d1" } });
    const [, , , before, after] = mocks.audit.mock.calls[0];
    expect(before.extraUnits).toEqual([]);
    expect(after.extraUnits).toEqual([{ vehicleId: "vB", driverId: "d1" }]);
  });

  it("no repite una nave en la salida ni suma una dada de baja", async () => {
    mocks.schedule = salida([unit("u1", "vB", 15)], []);
    expect(await addScheduleUnit({ actor, scheduleId: "s1", vehicleId: "vA", driverId: null, confirmation: "" })).toEqual({ error: "Esa nave ya está en la salida." });
    expect(await addScheduleUnit({ actor, scheduleId: "s1", vehicleId: "vB", driverId: null, confirmation: "" })).toEqual({ error: "Esa nave ya está en la salida." });
    expect((await addScheduleUnit({ actor, scheduleId: "s1", vehicleId: "vOff", driverId: null, confirmation: "" }) as { error: string }).error).toContain("no está disponible");
    expect(mocks.createUnit).not.toHaveBeenCalled();
  });

  it("un choque seguro no se guarda; un posible cruce pide confirmación", async () => {
    mocks.schedule = salida([], []);
    mocks.conflicts.mockResolvedValue([{ id: "x", label: "Servicio público · SMA → Traful", href: "", possible: false }]);
    expect(await addScheduleUnit({ actor, scheduleId: "s1", vehicleId: "vB", driverId: null, confirmation: "" })).toHaveProperty("error");
    mocks.conflicts.mockResolvedValue([{ id: "a", label: "Aeropuerto · AR1", href: "", possible: true }]);
    const pending = await addScheduleUnit({ actor, scheduleId: "s1", vehicleId: "vB", driverId: null, confirmation: "" });
    expect(pending).toHaveProperty("confirmation");
    expect(mocks.createUnit).not.toHaveBeenCalled();
    const confirmed = await addScheduleUnit({ actor, scheduleId: "s1", vehicleId: "vB", driverId: null, confirmation: (pending as { confirmation: string }).confirmation });
    expect(confirmed).toMatchObject({ ok: true });
  });

  it("no quita una nave si con las que quedan no entran los pasajeros", async () => {
    mocks.schedule = salida([unit("u1", "vB", 15)], [12, 10]);
    mocks.findUnit.mockResolvedValue({ scheduleId: "s1" });
    const result = await removeScheduleUnit({ actor, unitId: "u1" });
    expect((result as { error: string }).error).toContain("no entran los 22 pasajeros reservados (quedarían 19 lugares)");
    expect(mocks.deleteUnit).not.toHaveBeenCalled();
  });

  it("quitar la principal pasa la primera nave sumada a su lugar, con su chofer", async () => {
    mocks.schedule = salida([unit("u1", "vB", 15, true, "dB"), unit("u2", "vC", 4)], [10]);
    const result = await removeScheduleUnit({ actor, primaryOf: "s1" });
    expect(result).toMatchObject({ ok: true });
    expect(mocks.deleteUnit).toHaveBeenCalledWith({ where: { id: "u1" } });
    expect(mocks.updateSchedule).toHaveBeenCalledWith({ where: { id: "s1" }, data: { vehicleId: "vB", driverId: "dB" } });
    const [, , , , after] = mocks.audit.mock.calls[0];
    expect(after).toMatchObject({ vehicleId: "vB", driverId: "dB", extraUnits: [{ vehicleId: "vC", driverId: null }] });
  });

  it("una salida no se queda sin naves", async () => {
    mocks.schedule = salida([], []);
    expect((await removeScheduleUnit({ actor, primaryOf: "s1" }) as { error: string }).error).toContain("única nave");
  });

  it("cambiar una nave sumada que estaba dada de baja no la descuenta dos veces del cupo", async () => {
    // Cupo actual: 19 (la sumada inactiva no cuenta). Con vC (4) pasa a 23: entran 20 pasajeros.
    mocks.schedule = salida([unit("u1", "vOff", 30, false)], [20]);
    mocks.findUnit.mockResolvedValue({ scheduleId: "s1", vehicleId: "vOff", driverId: null });
    expect(await updateScheduleUnit({ actor, unitId: "u1", vehicleId: "vC", driverId: null, confirmation: "" })).toMatchObject({ ok: true });
    expect(mocks.updateUnit).toHaveBeenCalledWith({ where: { id: "u1" }, data: { vehicleId: "vC", driverId: null } });
  });

  it("cambiar una nave sumada por una más chica no deja pasajeros sin lugar", async () => {
    mocks.schedule = salida([unit("u1", "vB", 15)], [30]);
    mocks.findUnit.mockResolvedValue({ scheduleId: "s1", vehicleId: "vB", driverId: null });
    const result = await updateScheduleUnit({ actor, unitId: "u1", vehicleId: "vC", driverId: null, confirmation: "" });
    expect((result as { error: string }).error).toContain("no entran los 30 pasajeros");
    expect(mocks.updateUnit).not.toHaveBeenCalled();
  });

  it("sólo el chofer de una nave sumada: no revisa choques de flota", async () => {
    mocks.schedule = salida([unit("u1", "vB", 15)], []);
    mocks.findUnit.mockResolvedValue({ scheduleId: "s1", vehicleId: "vB", driverId: null });
    expect(await updateScheduleUnit({ actor, unitId: "u1", vehicleId: "vB", driverId: "d1", confirmation: "" }))
      .toMatchObject({ ok: true, summary: "Chofer asignado a una nave de la salida." });
    expect(mocks.conflicts).not.toHaveBeenCalled();
  });

  it("la nave principal no puede ser una ya sumada ni dejar pasajeros sin lugar", async () => {
    mocks.schedule = salida([unit("u1", "vB", 15)], [30]);
    expect(await primaryVehicleProblem(tx as never, "s1", "vB")).toContain("ya está sumada");
    expect(await primaryVehicleProblem(tx as never, "s1", "vC")).toContain("no entran los 30 pasajeros");
    expect(await primaryVehicleProblem(tx as never, "s1", "vA")).toBeNull();
  });
});
