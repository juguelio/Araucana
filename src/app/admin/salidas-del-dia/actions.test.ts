import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  staff: vi.fn(),
  findSchedule: vi.fn(),
  findVehicle: vi.fn(),
  findDriver: vi.fn(),
  updateSchedule: vi.fn(),
  findAssignment: vi.fn(),
  updateAssignment: vi.fn(),
  findDuty: vi.fn(),
  updateDuty: vi.fn(),
  lockFleet: vi.fn(),
  fleetConflicts: vi.fn(),
  audit: vi.fn(),
  auditAfterCommit: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("@/lib/auth/admin", () => ({ getCurrentAdminOrRedirect: mocks.admin, getCurrentReservationsUserOrRedirect: mocks.staff }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/audit/entity", () => ({ recordEntityAudit: mocks.audit, recordEntityAuditAfterCommit: mocks.auditAfterCommit }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    schedule: { findUnique: mocks.findSchedule },
    vehicle: { findUnique: mocks.findVehicle },
    user: { findFirst: mocks.findDriver },
    airportVehicleAssignment: { findUnique: mocks.findAssignment, update: mocks.updateAssignment },
    chapelcoVehicleDuty: { findUnique: mocks.findDuty, update: mocks.updateDuty },
    $transaction: (run: (tx: unknown) => unknown) => run({
      schedule: { update: mocks.updateSchedule, findUnique: mocks.findSchedule },
      vehicle: { findMany: async () => [{ id: "v1", name: "Sprinter 1" }, { id: "v2", name: "Sprinter 2" }] },
      user: { findMany: async () => [{ id: "d1", name: "Ramón Paz", email: "ramon@ejemplo.test" }] },
      travelRoute: { findUnique: async () => ({ from: "SMA", to: "Villa Traful" }) }
    })
  }
}));
vi.mock("@/lib/special-trips/conflicts", () => ({ fleetConflicts: mocks.fleetConflicts, lockFleet: mocks.lockFleet }));

import { saveScheduleCrewAction, setAirportDriverAction, setChapelcoDriverAction } from "./actions";

const salida = {
  id: "s1",
  routeId: "r1",
  vehicleId: "v1",
  driverId: null as string | null,
  departureAt: new Date("2026-11-17T09:00:00-03:00"),
  arrivalAt: new Date("2026-11-17T12:00:00-03:00"),
  status: "OPEN",
  route: { slug: "sma-villa-traful" }
};

async function redirectTo(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return decodeURIComponent((error as Error).message.replace(/\+/g, " "));
  }
  throw new Error("la acción terminó sin redirigir");
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ id: "admin", role: "ADMIN" });
  mocks.staff.mockResolvedValue({ id: "secre", role: "SECRETARY" });
  mocks.findSchedule.mockResolvedValue(salida);
  mocks.findVehicle.mockResolvedValue({ isActive: true });
  mocks.findDriver.mockResolvedValue({ id: "d1", name: "Ramón Paz", email: "ramon@ejemplo.test" });
  mocks.updateSchedule.mockImplementation(async ({ data }: { data: object }) => ({ ...salida, ...data }));
  mocks.fleetConflicts.mockResolvedValue([]);
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`redirect:${url}`);
  });
});

describe("salidas del día: nave y chofer de una salida de ruta (issue #174)", () => {
  it("sólo un administrador cambia la nave o el chofer de una salida", async () => {
    mocks.admin.mockRejectedValue(new Error("auth-denied"));
    await expect(saveScheduleCrewAction({}, form({ id: "s1", vehicleId: "v1", driverId: "d1" }))).rejects.toThrow("auth-denied");
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
  });

  it("asigna el chofer sin tocar la nave ni mirar choques de flota, y vuelve al tablero del día", async () => {
    const url = await redirectTo(saveScheduleCrewAction({}, form({ id: "s1", vehicleId: "v1", driverId: "d1", date: "2026-11-17" })));
    expect(mocks.updateSchedule).toHaveBeenCalledWith({ where: { id: "s1" }, data: { vehicleId: "v1", driverId: "d1" } });
    expect(mocks.fleetConflicts).not.toHaveBeenCalled();
    expect(mocks.findDriver).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "d1", role: "DRIVER", isActive: true } }));
    expect(url).toBe("redirect:/admin/salidas-del-dia?date=2026-11-17&notice=Chofer asignado a la salida.");
    // La auditoría guarda el chofer por nombre.
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      entity: "SCHEDULE", summary: "Chofer de la salida asignado.",
      before: expect.objectContaining({ driver: null }), after: expect.objectContaining({ driver: "Ramón Paz" })
    }));
  });

  it("rechaza un chofer que no está activo o no tiene rol de chofer", async () => {
    mocks.findDriver.mockResolvedValue(null);
    const state = await saveScheduleCrewAction({}, form({ id: "s1", vehicleId: "v1", driverId: "u9" }));
    expect(state).toEqual({ error: "Ese chofer no está disponible: elegí un chofer activo." });
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
  });

  it("si cambia la nave, controla choques igual que el calendario y no guarda si la unidad está tomada", async () => {
    mocks.fleetConflicts.mockResolvedValue([{ id: "f1", label: "Aeropuerto · AR1656", href: "", possible: true }]);
    const state = await saveScheduleCrewAction({}, form({ id: "s1", vehicleId: "v2", driverId: "" }));
    expect(state.error).toContain("No se cambió la nave");
    expect(state.error).toContain("Aeropuerto · AR1656");
    expect(mocks.fleetConflicts).toHaveBeenCalledWith(expect.anything(), { vehicleId: "v2", startsAt: salida.departureAt, endsAt: salida.arrivalAt }, undefined, "s1");
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
  });

  it("no acepta una nave inactiva", async () => {
    mocks.findVehicle.mockResolvedValue({ isActive: false });
    const state = await saveScheduleCrewAction({}, form({ id: "s1", vehicleId: "v2", driverId: "" }));
    expect(state.error).toContain("no está disponible");
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
  });

  it("sin cambios no escribe nada", async () => {
    const url = await redirectTo(saveScheduleCrewAction({}, form({ id: "s1", vehicleId: "v1", driverId: "" })));
    expect(url).toContain("ya tenía esa nave y ese chofer");
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
  });

  it("una fecha armada a mano no se usa para volver: vuelve al día de la salida", async () => {
    const url = await redirectTo(saveScheduleCrewAction({}, form({ id: "s1", vehicleId: "v1", driverId: "d1", date: "https://otro.sitio" })));
    expect(url).toContain("/admin/salidas-del-dia?date=2026-11-17&");
  });
});

describe("salidas del día: chofer de una combi del aeropuerto y de una nave de Chapelco", () => {
  it("la secretaría asigna el chofer de una combi ya asignada al vuelo", async () => {
    mocks.findAssignment.mockResolvedValue({
      driverId: null, flight: { id: "f1", number: "AR1656", scheduledAt: new Date("2026-11-17T08:30:00-03:00") },
      vehicle: { name: "Combi 243" }, driver: null
    });
    const url = await redirectTo(setAirportDriverAction(form({ id: "a1", driverId: "d1" })));
    expect(mocks.updateAssignment).toHaveBeenCalledWith({ where: { id: "a1" }, data: { driverId: "d1" } });
    expect(url).toBe("redirect:/admin/salidas-del-dia?date=2026-11-17&notice=Chofer asignado a la combi.");
    expect(mocks.auditAfterCommit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      entity: "AIRPORT", entityId: "f1", before: { driver: null }, after: { driver: "Ramón Paz" }
    }));
  });

  it("quitar el chofer de la combi no consulta choferes", async () => {
    mocks.findAssignment.mockResolvedValue({
      driverId: "d1", flight: { id: "f1", number: "AR1656", scheduledAt: new Date("2026-11-17T08:30:00-03:00") },
      vehicle: { name: "Combi 243" }, driver: { name: "Ramón Paz", email: "ramon@ejemplo.test" }
    });
    const url = await redirectTo(setAirportDriverAction(form({ id: "a1", driverId: "" })));
    expect(mocks.findDriver).not.toHaveBeenCalled();
    expect(mocks.updateAssignment).toHaveBeenCalledWith({ where: { id: "a1" }, data: { driverId: null } });
    expect(url).toContain("Chofer quitado de la combi.");
  });

  it("no asigna un chofer inactivo a la combi", async () => {
    mocks.findDriver.mockResolvedValue(null);
    mocks.findAssignment.mockResolvedValue({
      driverId: null, flight: { id: "f1", number: "AR1656", scheduledAt: new Date("2026-11-17T08:30:00-03:00") },
      vehicle: { name: "Combi 243" }, driver: null
    });
    const url = await redirectTo(setAirportDriverAction(form({ id: "a1", driverId: "u9" })));
    expect(mocks.updateAssignment).not.toHaveBeenCalled();
    expect(url).toContain("Ese chofer no está disponible");
  });

  it("asigna el chofer de una nave del día de Chapelco", async () => {
    mocks.findDuty.mockResolvedValue({
      driverId: null, operationDayId: "o1", operationDay: { serviceDate: new Date("2026-07-12T00:00:00Z") },
      vehicle: { name: "Bus 444" }, driver: null
    });
    const url = await redirectTo(setChapelcoDriverAction(form({ id: "u1", driverId: "d1" })));
    expect(mocks.updateDuty).toHaveBeenCalledWith({ where: { id: "u1" }, data: { driverId: "d1" } });
    expect(url).toBe("redirect:/admin/salidas-del-dia?date=2026-07-12&notice=Chofer asignado a la nave.");
  });
});
