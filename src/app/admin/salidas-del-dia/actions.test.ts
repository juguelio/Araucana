import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  staff: vi.fn(),
  findSchedule: vi.fn(),
  findVehicle: vi.fn(),
  findDriver: vi.fn(),
  updateSchedule: vi.fn(),
  findDuty: vi.fn(),
  updateDuty: vi.fn(),
  lockFleet: vi.fn(),
  fleetConflicts: vi.fn(),
  audit: vi.fn(),
  auditAfterCommit: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn(),
  findRoute: vi.fn(),
  createSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  findTrip: vi.fn(),
  touchTrip: vi.fn(),
  findSpecialAssignment: vi.fn(),
  createSpecialAssignment: vi.fn(),
  updateSpecialAssignment: vi.fn(),
  deleteSpecialAssignment: vi.fn(),
  acceptance: vi.fn(),
  findScheduleAtTime: vi.fn(),
  countUnits: vi.fn(),
  primaryProblem: vi.fn(),
  addUnit: vi.fn(),
  updateUnit: vi.fn(),
  removeUnit: vi.fn()
}));

vi.mock("@/lib/auth/admin", () => ({ getCurrentAdminOrRedirect: mocks.admin, getCurrentReservationsUserOrRedirect: mocks.staff }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/audit/entity", () => ({ recordEntityAudit: mocks.audit, recordEntityAuditAfterCommit: mocks.auditAfterCommit }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    schedule: { findUnique: mocks.findSchedule, findFirst: mocks.findScheduleAtTime },
    scheduleUnit: { count: mocks.countUnits },
    vehicle: { findUnique: mocks.findVehicle },
    travelRoute: { findUnique: mocks.findRoute },
    specialTrip: { findUnique: mocks.findTrip },
    specialTripAssignment: { findUnique: mocks.findSpecialAssignment },
    user: { findFirst: mocks.findDriver },
    chapelcoVehicleDuty: { findUnique: mocks.findDuty, update: mocks.updateDuty },
    $transaction: (run: (tx: unknown) => unknown) => run({
      schedule: { update: mocks.updateSchedule, findUnique: mocks.findSchedule, create: mocks.createSchedule, delete: mocks.deleteSchedule },
      specialTrip: { update: mocks.touchTrip },
      specialTripAssignment: { create: mocks.createSpecialAssignment, update: mocks.updateSpecialAssignment, delete: mocks.deleteSpecialAssignment },
      vehicle: { findMany: async () => [{ id: "v1", name: "Sprinter 1" }, { id: "v2", name: "Sprinter 2" }] },
      user: { findMany: async () => [{ id: "d1", name: "Ramón Paz", email: "ramon@ejemplo.test" }] },
      travelRoute: { findUnique: async () => ({ from: "SMA", to: "Villa Traful" }) }
    })
  }
}));
vi.mock("@/lib/special-trips/conflicts", () => ({
  fleetConflicts: mocks.fleetConflicts,
  lockFleet: mocks.lockFleet,
  recordAcceptance: mocks.acceptance,
  conflictKey: (conflicts: Array<{ id: string }>, proposal: unknown) => JSON.stringify([proposal, conflicts.map((c) => c.id)])
}));

vi.mock("@/lib/booking/schedule-unit-service", () => ({
  primaryVehicleProblem: mocks.primaryProblem,
  addScheduleUnit: mocks.addUnit,
  updateScheduleUnit: mocks.updateUnit,
  removeScheduleUnit: mocks.removeUnit
}));

import {
  addBoardUnitAction, addSpecialVehicleAction, createBoardScheduleAction, removeBoardScheduleAction, removeSpecialVehicleAction,
  saveScheduleCrewAction, setChapelcoDriverAction, setSpecialDriverAction
} from "./actions";

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

  it("si cambia la nave a una ocupada por otra salida, no guarda y dice con qué choca", async () => {
    mocks.fleetConflicts.mockResolvedValue([{ id: "s7", label: "Servicio público · SMA → Traful", href: "", possible: false }]);
    const state = await saveScheduleCrewAction({}, form({ id: "s1", vehicleId: "v2", driverId: "" }));
    expect(state.error).toContain("No se cambió la nave");
    expect(state.error).toContain("Servicio público · SMA → Traful");
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

describe("salidas del día: chofer de una nave de Chapelco", () => {
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

describe("salidas del día: crear y sumar unidades (más flexibilidad)", () => {
  beforeEach(() => {
    mocks.findRoute.mockResolvedValue({ id: "r1", slug: "sma-villa-traful", durationMin: 135, bookingMode: "REGULAR", isActive: true });
    mocks.createSchedule.mockImplementation(async ({ data }: { data: object }) => ({ id: "s9", status: "OPEN", ...data }));
  });

  it("crea una salida del día con nave y chofer; la llegada sale de la duración de la ruta", async () => {
    const url = await redirectTo(createBoardScheduleAction({}, form({ date: "2026-11-17", routeId: "r1", time: "08:00", vehicleId: "v2", driverId: "d1" })));
    expect(mocks.createSchedule).toHaveBeenCalledWith({ data: {
      routeId: "r1", vehicleId: "v2", driverId: "d1", status: "OPEN",
      departureAt: new Date("2026-11-17T08:00:00-03:00"), arrivalAt: new Date("2026-11-17T10:15:00-03:00")
    } });
    expect(url).toBe("redirect:/admin/salidas-del-dia?date=2026-11-17&notice=Salida creada.");
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ summary: "Salida creada desde Salidas del día.", before: null }));
  });

  it("no crea la salida si la nave ya está tomada en ese horario", async () => {
    mocks.fleetConflicts.mockResolvedValue([{ id: "x", label: "Servicio público · SMA → Traful", href: "", possible: false }]);
    const state = await createBoardScheduleAction({}, form({ date: "2026-11-17", routeId: "r1", time: "08:00", vehicleId: "v2" }));
    expect(state.error).toContain("la nave ya está tomada");
    expect(mocks.createSchedule).not.toHaveBeenCalled();
  });

  it("no crea salidas de aeropuerto ni de Chapelco desde acá, y pide hora y nave", async () => {
    mocks.findRoute.mockResolvedValue({ id: "r2", slug: "x", durationMin: 60, bookingMode: "AIRPORT", isActive: true });
    expect((await createBoardScheduleAction({}, form({ date: "2026-11-17", routeId: "r2", time: "08:00", vehicleId: "v2" }))).error).toContain("no tiene salidas propias");
    expect((await createBoardScheduleAction({}, form({ date: "2026-11-17", routeId: "r1", time: "", vehicleId: "v2" }))).error).toBe("Poné la hora de salida.");
    expect((await createBoardScheduleAction({}, form({ date: "2026-11-17", routeId: "r1", time: "08:00", vehicleId: "" }))).error).toBe("Elegí la nave.");
    expect(mocks.createSchedule).not.toHaveBeenCalled();
  });

  it("crear salidas es de administración", async () => {
    mocks.admin.mockRejectedValue(new Error("auth-denied"));
    await expect(createBoardScheduleAction({}, form({ date: "2026-11-17", routeId: "r1", time: "08:00", vehicleId: "v2" }))).rejects.toThrow("auth-denied");
  });

  it("quita una unidad sin reservas y no toca una que tiene", async () => {
    mocks.findSchedule.mockResolvedValue({ ...salida, _count: { reservations: 0 } });
    expect(await redirectTo(removeBoardScheduleAction(form({ id: "s1", date: "2026-11-17" })))).toContain("Unidad quitada.");
    expect(mocks.deleteSchedule).toHaveBeenCalledWith({ where: { id: "s1" } });

    mocks.deleteSchedule.mockClear();
    mocks.findSchedule.mockResolvedValue({ ...salida, _count: { reservations: 2 } });
    expect(await redirectTo(removeBoardScheduleAction(form({ id: "s1", date: "2026-11-17" })))).toContain("tiene reservas");
    expect(mocks.deleteSchedule).not.toHaveBeenCalled();
  });
});

describe("salidas del día: naves y choferes de un viaje especial", () => {
  const viaje = { id: "t1", client: "Colegio San Jorge", serviceDate: new Date("2026-11-17T00:00:00Z"), status: "CONFIRMED" };

  it("suma una nave con su horario y avisa a la ficha que el viaje cambió", async () => {
    mocks.findTrip.mockResolvedValue(viaje);
    const url = await redirectTo(addSpecialVehicleAction({}, form({ tripId: "t1", vehicleId: "v2", driverId: "d1", from: "07:00", to: "19:00" })));
    expect(mocks.createSpecialAssignment).toHaveBeenCalledWith({ data: {
      tripId: "t1", vehicleId: "v2", driverId: "d1",
      startsAt: new Date("2026-11-17T07:00:00-03:00"), endsAt: new Date("2026-11-17T19:00:00-03:00")
    } });
    expect(mocks.touchTrip).toHaveBeenCalledWith({ where: { id: "t1" }, data: { updatedAt: expect.any(Date) } });
    expect(url).toContain("Nave sumada al viaje.");
  });

  it("si la nave choca, muestra el choque y pide confirmación antes de guardar", async () => {
    mocks.findTrip.mockResolvedValue(viaje);
    mocks.fleetConflicts.mockResolvedValue([{ id: "a1", label: "Aeropuerto · AR1656", href: "", possible: true }]);
    const first = await addSpecialVehicleAction({}, form({ tripId: "t1", vehicleId: "v2", from: "07:00", to: "19:00" }));
    expect(first.conflicts?.[0].label).toBe("Aeropuerto · AR1656");
    expect(mocks.createSpecialAssignment).not.toHaveBeenCalled();

    const url = await redirectTo(addSpecialVehicleAction({}, form({ tripId: "t1", vehicleId: "v2", from: "07:00", to: "19:00", confirmation: first.confirmation! })));
    expect(mocks.createSpecialAssignment).toHaveBeenCalled();
    expect(mocks.acceptance).toHaveBeenCalledWith(expect.anything(), "SPECIAL", "t1", "secre", first.conflicts);
    expect(url).toContain("Nave sumada al viaje.");
  });

  it("rechaza un horario al revés", async () => {
    mocks.findTrip.mockResolvedValue(viaje);
    const state = await addSpecialVehicleAction({}, form({ tripId: "t1", vehicleId: "v2", from: "19:00", to: "07:00" }));
    expect(state.error).toContain("Revisá el horario");
  });

  it("chofer y quitar nave de un viaje especial", async () => {
    mocks.findSpecialAssignment.mockResolvedValue({ driverId: null, tripId: "t1", vehicle: { name: "Bus 444" }, driver: null, trip: { client: "Colegio", serviceDate: viaje.serviceDate } });
    expect(await redirectTo(setSpecialDriverAction(form({ id: "x1", driverId: "d1" })))).toContain("Chofer asignado al viaje.");
    expect(mocks.updateSpecialAssignment).toHaveBeenCalledWith({ where: { id: "x1" }, data: { driverId: "d1" } });
    expect(await redirectTo(removeSpecialVehicleAction(form({ id: "x1" })))).toContain("Nave quitada del viaje.");
    expect(mocks.deleteSpecialAssignment).toHaveBeenCalledWith({ where: { id: "x1" } });
    expect(mocks.touchTrip).toHaveBeenCalledTimes(2);
  });
});

describe("salidas del día: posibles cruces se confirman, choques seguros no", () => {
  beforeEach(() => {
    mocks.findRoute.mockResolvedValue({ id: "r1", slug: "sma-villa-traful", durationMin: 135, bookingMode: "REGULAR", isActive: true });
    mocks.createSchedule.mockImplementation(async ({ data }: { data: object }) => ({ id: "s9", status: "OPEN", ...data }));
  });

  it("la combi de un vuelo (cruce posible, cuenta todo el día) se puede usar en una salida si se confirma", async () => {
    const aviso = [{ id: "a1", label: "Aeropuerto · AR1656", href: "", possible: true }];
    mocks.fleetConflicts.mockResolvedValue(aviso);
    const fields = { date: "2026-11-17", routeId: "r1", time: "18:00", vehicleId: "v1" };
    const first = await createBoardScheduleAction({}, form(fields));
    expect(first.conflicts).toEqual(aviso);
    expect(mocks.createSchedule).not.toHaveBeenCalled();
    const url = await redirectTo(createBoardScheduleAction({}, form({ ...fields, confirmation: first.confirmation! })));
    expect(url).toContain("Salida creada.");
    expect(mocks.acceptance).toHaveBeenCalledWith(expect.anything(), "PUBLIC", "s9", "admin", aviso);
  });

  it("lo mismo al cambiar la nave de una salida", async () => {
    mocks.fleetConflicts.mockResolvedValue([{ id: "a1", label: "Aeropuerto · AR1656", href: "", possible: true }]);
    const first = await saveScheduleCrewAction({}, form({ id: "s1", vehicleId: "v2", driverId: "" }));
    expect(first.conflicts?.[0].label).toBe("Aeropuerto · AR1656");
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
    await redirectTo(saveScheduleCrewAction({}, form({ id: "s1", vehicleId: "v2", driverId: "", confirmation: first.confirmation! })));
    expect(mocks.updateSchedule).toHaveBeenCalledWith({ where: { id: "s1" }, data: { vehicleId: "v2", driverId: null } });
  });
});


describe("salidas del día: varias naves en una misma salida", () => {
  const listo = { ok: true as const, summary: "Nave sumada a la salida.", schedule: { id: "s1", routeId: "r1", departureAt: salida.departureAt, slug: "sma-villa-traful" } };

  beforeEach(() => {
    mocks.findRoute.mockResolvedValue({ id: "r1", slug: "sma-villa-traful", durationMin: 135, bookingMode: "REGULAR", isActive: true });
    mocks.findScheduleAtTime.mockResolvedValue(null);
    mocks.countUnits.mockResolvedValue(0);
    mocks.primaryProblem.mockResolvedValue(null);
  });

  it("sumar nave la agrega a la misma salida, no crea otra", async () => {
    mocks.addUnit.mockResolvedValue(listo);
    const url = await redirectTo(addBoardUnitAction({}, form({ date: "2026-11-17", scheduleId: "s1", vehicleId: "v2", driverId: "d1" })));
    expect(mocks.addUnit).toHaveBeenCalledWith(expect.objectContaining({ scheduleId: "s1", vehicleId: "v2", driverId: "d1" }));
    expect(mocks.createSchedule).not.toHaveBeenCalled();
    expect(url).toBe("redirect:/admin/salidas-del-dia?date=2026-11-17&notice=Nave sumada a la salida.");
    expect(mocks.refresh).toHaveBeenCalledWith("/reservar/sma-villa-traful");
  });

  it("si la ruta ya tiene salida a esa hora, «crear salida» le suma la nave", async () => {
    mocks.findScheduleAtTime.mockResolvedValue({ id: "s1" });
    mocks.addUnit.mockResolvedValue(listo);
    await redirectTo(createBoardScheduleAction({}, form({ date: "2026-11-17", routeId: "r1", time: "09:00", vehicleId: "v2" })));
    expect(mocks.addUnit).toHaveBeenCalledWith(expect.objectContaining({ scheduleId: "s1", vehicleId: "v2" }));
    expect(mocks.createSchedule).not.toHaveBeenCalled();
  });

  it("un choque o un error al sumar vuelve al formulario sin redirigir", async () => {
    mocks.addUnit.mockResolvedValue({ conflicts: [{ id: "a", label: "Aeropuerto · AR1", href: "", possible: true }], confirmation: "k" });
    const state = await addBoardUnitAction({}, form({ date: "2026-11-17", scheduleId: "s1", vehicleId: "v2" }));
    expect(state).toMatchObject({ confirmation: "k" });
    mocks.addUnit.mockResolvedValue({ error: "Esa nave ya está en la salida." });
    expect((await addBoardUnitAction({}, form({ date: "2026-11-17", scheduleId: "s1", vehicleId: "v1" }))).error).toBe("Esa nave ya está en la salida.");
  });

  it("chofer de una nave sumada: se guarda en esa nave, no en la salida", async () => {
    mocks.updateUnit.mockResolvedValue({ ...listo, summary: "Chofer asignado a una nave de la salida." });
    await redirectTo(saveScheduleCrewAction({}, form({ id: "u1", kind: "EXTRA", date: "2026-11-17", vehicleId: "v2", driverId: "d1" })));
    expect(mocks.updateUnit).toHaveBeenCalledWith(expect.objectContaining({ unitId: "u1", vehicleId: "v2", driverId: "d1" }));
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
  });

  it("quitar una nave sumada o la principal (con otras) no borra la salida", async () => {
    mocks.removeUnit.mockResolvedValue({ ...listo, summary: "Nave quitada de la salida." });
    await redirectTo(removeBoardScheduleAction(form({ id: "u1", kind: "EXTRA", date: "2026-11-17" })));
    expect(mocks.removeUnit).toHaveBeenLastCalledWith(expect.objectContaining({ unitId: "u1" }));
    mocks.countUnits.mockResolvedValue(1);
    await redirectTo(removeBoardScheduleAction(form({ id: "s1", kind: "PRIMARY", date: "2026-11-17" })));
    expect(mocks.removeUnit).toHaveBeenLastCalledWith(expect.objectContaining({ primaryOf: "s1" }));
    expect(mocks.deleteSchedule).not.toHaveBeenCalled();
    mocks.removeUnit.mockResolvedValue({ error: "No se quitó: con las naves que quedan no entran los 30 pasajeros reservados (quedarían 19 lugares)." });
    expect(await redirectTo(removeBoardScheduleAction(form({ id: "u1", kind: "EXTRA", date: "2026-11-17" })))).toContain("no entran los 30 pasajeros");
  });

  it("cambiar la nave principal por una que ya está sumada no se guarda", async () => {
    mocks.primaryProblem.mockResolvedValue("Esa nave ya está sumada a la salida: quitala de las otras naves o elegí otra.");
    const state = await saveScheduleCrewAction({}, form({ id: "s1", date: "2026-11-17", vehicleId: "v2" }));
    expect(state.error).toContain("ya está sumada");
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
  });
});
