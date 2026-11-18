import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  staff: vi.fn(),
  findFlight: vi.fn(),
  findAssignment: vi.fn(),
  upsert: vi.fn(),
  findDriver: vi.fn(),
  findVehicle: vi.fn(),
  findUsers: vi.fn(),
  lockFleet: vi.fn(),
  specialConflicts: vi.fn(),
  driverConflicts: vi.fn(),
  acceptance: vi.fn(),
  audit: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("@/lib/auth/admin", () => ({ getCurrentReservationsUserOrRedirect: mocks.staff }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/audit/entity", () => ({ recordEntityAudit: mocks.audit, recordEntityAuditAfterCommit: vi.fn(), readForAudit: vi.fn() }));
vi.mock("@/lib/special-trips/conflicts", () => ({
  dayInterval: (day: string) => ({ startsAt: new Date(`${day}T00:00:00-03:00`), endsAt: new Date(`${day}T23:59:59-03:00`) }),
  lockFleet: mocks.lockFleet,
  specialConflicts: mocks.specialConflicts,
  driverConflicts: mocks.driverConflicts,
  recordAcceptance: mocks.acceptance,
  conflictKey: (conflicts: Array<{ id: string }>, proposal: unknown) => JSON.stringify([proposal, conflicts.map((c) => c.id)])
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: (run: (tx: unknown) => unknown) => run({
      flight: { findUnique: mocks.findFlight },
      airportVehicleAssignment: { findUnique: mocks.findAssignment, upsert: mocks.upsert },
      vehicle: { findUnique: mocks.findVehicle },
      user: { findFirst: mocks.findDriver, findMany: mocks.findUsers }
    })
  }
}));

import { assignVehicleAction } from "./actions";

const vuelo = {
  id: "f1", number: "AR 1656", direction: "ARRIVAL", status: "SCHEDULED",
  scheduledAt: new Date("2026-11-20T14:00:00-03:00"), estimatedAt: null, pickupStartOverrideAt: null
};

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function redirectTo(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return decodeURIComponent((error as Error).message);
  }
  throw new Error("la acción terminó sin redirigir");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.staff.mockResolvedValue({ id: "secre", role: "SECRETARY" });
  mocks.findFlight.mockResolvedValue(vuelo);
  mocks.findAssignment.mockResolvedValue(null);
  mocks.upsert.mockResolvedValue({ id: "asig1" });
  mocks.findDriver.mockResolvedValue({ id: "d1" });
  mocks.findVehicle.mockResolvedValue({ name: "Sprinter 1" });
  mocks.findUsers.mockResolvedValue([{ id: "d1", name: "Ramón Paz", email: "ramon@ejemplo.test" }, { id: "d2", name: null, email: "lucia@ejemplo.test" }]);
  mocks.specialConflicts.mockResolvedValue([]);
  mocks.driverConflicts.mockResolvedValue([]);
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`redirect:${url}`);
  });
});

describe("aeropuerto: combi y chofer desde el modal «Asignar combi»", () => {
  it("asigna la combi con su chofer, lo audita por nombre y vuelve al día del vuelo", async () => {
    const url = await redirectTo(assignVehicleAction(undefined, form({ flightId: "f1", vehicleId: "v1", driverId: "d1" })));
    expect(mocks.findDriver).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "d1", role: "DRIVER", isActive: true } }));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { flightId: "f1", vehicleId: "v1", driverId: "d1" } }));
    // El chofer se controla en el tramo del arribo (media hora antes hasta terminar el reparto), sin contar esta misma combi.
    expect(mocks.driverConflicts).toHaveBeenCalledWith(expect.anything(), {
      driverId: "d1", startsAt: new Date("2026-11-20T13:30:00-03:00"), endsAt: new Date("2026-11-20T16:00:00-03:00")
    }, { flightId: "f1", vehicleId: "v1" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      entity: "AIRPORT", entityId: "f1", action: "CREATE", summary: "Combi Sprinter 1 asignada al vuelo.",
      before: null, after: { vehicle: "Sprinter 1", driver: "Ramón Paz" }
    }));
    expect(url).toBe("redirect:/admin/aeropuerto?date=2026-11-20&notice=Combi asignada al vuelo.");
  });

  it("cambia el chofer de una combi ya asignada sin volver a controlar la nave", async () => {
    mocks.findAssignment.mockResolvedValue({ driverId: "d2" });
    const url = await redirectTo(assignVehicleAction(undefined, form({ flightId: "f1", vehicleId: "v1", driverId: "d1" })));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { driverId: "d1" } }));
    expect(mocks.specialConflicts).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "UPDATE", summary: "Chofer de la combi Sprinter 1 cambiado en el vuelo.",
      before: { vehicle: "Sprinter 1", driver: "lucia@ejemplo.test" }, after: { vehicle: "Sprinter 1", driver: "Ramón Paz" }
    }));
    expect(url).toBe("redirect:/admin/aeropuerto?date=2026-11-20&notice=Chofer asignado a la combi.");
  });

  it("quita el chofer de una combi y no busca cruces", async () => {
    mocks.findAssignment.mockResolvedValue({ driverId: "d1" });
    const url = await redirectTo(assignVehicleAction(undefined, form({ flightId: "f1", vehicleId: "v1", driverId: "" })));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { driverId: null } }));
    expect(mocks.driverConflicts).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ summary: "Chofer de la combi Sprinter 1 quitado del vuelo." }));
    expect(url).toContain("notice=Chofer quitado de la combi.");
  });

  it("no guarda nada si la combi ya tenía ese chofer", async () => {
    mocks.findAssignment.mockResolvedValue({ driverId: "d1" });
    expect(await assignVehicleAction(undefined, form({ flightId: "f1", vehicleId: "v1", driverId: "d1" }))).toEqual({ error: "La combi ya tenía ese chofer." });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rechaza un chofer que no está activo", async () => {
    mocks.findDriver.mockResolvedValue(null);
    expect(await assignVehicleAction(undefined, form({ flightId: "f1", vehicleId: "v1", driverId: "dx" })))
      .toEqual({ error: "Ese chofer no está disponible: elegí un chofer activo." });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("si el chofer ya maneja otra salida a esa hora avisa, y guarda sólo al confirmar", async () => {
    const cruce = { id: "chofer:s1", label: "Chofer · Servicio público · SMA → Villa Traful", href: "/admin/rutas/r1/salidas/s1", possible: false, subject: "driver" };
    mocks.driverConflicts.mockResolvedValue([cruce]);
    const aviso = await assignVehicleAction(undefined, form({ flightId: "f1", vehicleId: "v1", driverId: "d1" }));
    expect(aviso).toEqual({ conflicts: [cruce], confirmation: JSON.stringify([["f1", "v1", "d1"], ["chofer:s1"]]) });
    expect(mocks.upsert).not.toHaveBeenCalled();

    await redirectTo(assignVehicleAction(undefined, form({ flightId: "f1", vehicleId: "v1", driverId: "d1", confirmation: (aviso as { confirmation: string }).confirmation })));
    expect(mocks.upsert).toHaveBeenCalled();
    expect(mocks.acceptance).toHaveBeenCalledWith(expect.anything(), "AIRPORT", "asig1", "secre", [cruce]);
  });

  it("desde el tablero (sin campo de chofer) suma la combi sin chofer", async () => {
    await redirectTo(assignVehicleAction(undefined, form({ flightId: "f1", vehicleId: "v1" })));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { flightId: "f1", vehicleId: "v1", driverId: null } }));
    expect(mocks.findDriver).not.toHaveBeenCalled();
  });
});
