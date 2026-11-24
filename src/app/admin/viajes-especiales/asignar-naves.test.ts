import { beforeEach, expect, it, vi } from "vitest";
import { asignarNavesPendientes, editarNavesDelViaje } from "./asignar-naves";

const db = vi.hoisted(() => ({ lookup: vi.fn(), insert: vi.fn(), remove: vi.fn(), update: vi.fn(), count: vi.fn(), driverConflicts: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  $transaction: (fn: (tx: unknown) => unknown) => fn({
    $queryRaw: vi.fn(), specialTrip: { findUnique: db.lookup, update: db.update },
    specialTripAssignment: { createMany: db.insert, deleteMany: db.remove }, user: { count: db.count }, vehicle: { count: db.count }
  })
} }));
vi.mock("@/lib/auth/admin", () => ({ getCurrentReservationsUserOrRedirect: async () => ({ id: "admin" }) }));
vi.mock("@/lib/audit/entity", () => ({ recordEntityAudit: vi.fn() }));
vi.mock("@/lib/special-trips/conflicts", () => ({ lockFleet: vi.fn(), recordAcceptance: vi.fn(), fleetConflicts: async () => [], driverConflicts: db.driverConflicts, conflictKey: () => "confirmar" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const version = "2026-11-23T13:00:00.000Z";
const trip = { client: "Escuela", status: "PENDING", updatedAt: new Date(version), assignments: [] };
const units = ["1", "2"].map(n => ({ vehicleId: "v" + n, driverId: "d" + n, start: "2026-11-25T08:00", end: "2026-11-25T18:00" }));
beforeEach(() => { vi.clearAllMocks(); db.count.mockResolvedValue(2); db.lookup.mockResolvedValue(trip); db.driverConflicts.mockResolvedValue([]); });

it("guarda dos naves con sus respectivos choferes en una transacción", async () => {
  expect(await asignarNavesPendientes("t", version, units, "")).toEqual({ ok: true });
  expect(db.insert).toHaveBeenCalledWith({ data: units.map(u => expect.objectContaining({ tripId: "t", vehicleId: u.vehicleId, driverId: u.driverId })) });
});
it("preserva las asignaciones cargadas por otro operador", async () => {
  db.lookup.mockResolvedValue({ ...trip, assignments: [{ id: "existente" }] });
  expect(await asignarNavesPendientes("t", version, units, "")).toHaveProperty("error");
  expect(db.insert).not.toHaveBeenCalled();
});
it("evita la doble asignación de un chofer y pide confirmar conflictos externos", async () => {
  expect(await asignarNavesPendientes("t", version, [units[0], { ...units[1], driverId: "d1" }], "")).toHaveProperty("error");
  db.driverConflicts.mockResolvedValue([{ id: "chofer:ocupado", subject: "driver" }]);
  expect(await asignarNavesPendientes("t", version, units, "")).toHaveProperty("confirmation", "confirmar");
  expect(db.insert).not.toHaveBeenCalled();
});

it("edita las naves sin reemplazar las asignaciones que no cambiaron y devuelve la versión nueva", async () => {
  const updatedAt = new Date("2026-11-23T13:01:00.000Z");
  db.update.mockResolvedValue({ updatedAt });
  db.lookup.mockResolvedValue({ ...trip, assignments: [{
    id: "existente", vehicleId: "v1", driverId: "d1",
    startsAt: new Date("2026-11-25T11:00:00Z"), endsAt: new Date("2026-11-25T21:00:00Z")
  }] });
  db.count.mockResolvedValue(1);
  expect(await editarNavesDelViaje("t", version, units, "")).toEqual({ ok: true, version: updatedAt.toISOString() });
  expect(db.insert).toHaveBeenCalledWith({ data: [expect.objectContaining({ vehicleId: "v2" })] });
  expect(db.remove).not.toHaveBeenCalled();
  expect(db.driverConflicts).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ driverId: "d2" }), undefined, "t");
});
