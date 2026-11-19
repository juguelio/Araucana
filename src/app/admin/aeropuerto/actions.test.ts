import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  staff: vi.fn(),
  findFlight: vi.fn(),
  findFlights: vi.fn(),
  findAssignment: vi.fn(),
  findAssignments: vi.fn(),
  upsert: vi.fn(),
  deleteAssignments: vi.fn(),
  findDriver: vi.fn(),
  findVehicle: vi.fn(),
  findUsers: vi.fn(),
  lockFleet: vi.fn(),
  specialConflicts: vi.fn(),
  driverConflicts: vi.fn(),
  acceptance: vi.fn(),
  audit: vi.fn(),
  auditAfterCommit: vi.fn(),
  readForAudit: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("@/lib/auth/admin", () => ({ getCurrentReservationsUserOrRedirect: mocks.staff }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/audit/entity", () => ({ recordEntityAudit: mocks.audit, recordEntityAuditAfterCommit: mocks.auditAfterCommit, readForAudit: mocks.readForAudit }));
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
    airportVehicleAssignment: { findUnique: mocks.findAssignment, findMany: mocks.findAssignments, deleteMany: mocks.deleteAssignments },
    $transaction: (run: (tx: unknown) => unknown) => run({
      flight: { findUnique: mocks.findFlight, findMany: mocks.findFlights },
      airportVehicleAssignment: {
        findUnique: mocks.findAssignment, findMany: mocks.findAssignments,
        upsert: mocks.upsert, deleteMany: mocks.deleteAssignments
      },
      vehicle: { findUnique: mocks.findVehicle },
      user: { findFirst: mocks.findDriver, findMany: mocks.findUsers }
    })
  }
}));

import { assignVehicleAction, removeAssignmentAction } from "./actions";

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
  mocks.readForAudit.mockImplementation((read: () => unknown) => read());
  mocks.findFlight.mockResolvedValue(vuelo);
  mocks.findFlights.mockResolvedValue([]);
  mocks.findAssignment.mockResolvedValue(null);
  mocks.findAssignments.mockResolvedValue([]);
  mocks.upsert.mockResolvedValue({ id: "asig1" });
  mocks.deleteAssignments.mockResolvedValue({ count: 0 });
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
    }, { flightId: "f1", vehicleId: "v1", sameTrip: [] });
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

  it("al editar el chofer desde el panel conserva el origen y actualiza la orden", async () => {
    mocks.findAssignment.mockResolvedValue({ id: "a1", driverId: null });
    const url = await redirectTo(assignVehicleAction(undefined, form({
      flightId: "f1", vehicleId: "v1", assignmentId: "a1", driverId: "d1", volver: "tablero", panelOrigin: "panel"
    })));
    const destination = new URL(url.replace("redirect:", ""), "http://localhost");
    expect(destination.pathname).toBe("/admin");
    expect(destination.searchParams.get("date")).toBe("2026-11-20");
    expect(destination.searchParams.get("notice")).toBe("Chofer asignado a la combi.");
    expect(mocks.refresh).toHaveBeenCalledWith("/admin/aeropuerto/orden-de-servicio/ver");
  });

  it("un selector abierto antes de quitar la combi no vuelve a crear la asignación", async () => {
    const result = await assignVehicleAction(undefined, form({ flightId: "f1", vehicleId: "v1", assignmentId: "anterior", driverId: "d1" }));
    expect(result).toHaveProperty("error");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("desde el tablero (sin campo de chofer) suma la combi sin chofer", async () => {
    await redirectTo(assignVehicleAction(undefined, form({ flightId: "f1", vehicleId: "v1" })));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { flightId: "f1", vehicleId: "v1", driverId: null } }));
    expect(mocks.findDriver).not.toHaveBeenCalled();
  });
});

describe("aeropuerto: la combi y el chofer son de la recorrida, no de un vuelo suelto", () => {
  const ar = { id: "f1", number: "AR1657", scheduledAt: new Date("2026-11-19T22:00:00-03:00") };
  const ja = { id: "f2", number: "JA3184", scheduledAt: new Date("2026-11-19T22:13:00-03:00") };

  beforeEach(() => {
    // Los dos vuelos comparten la vuelta (`pickupGroupId`), como AR1657 y JA3184 en producción.
    mocks.findFlight.mockResolvedValue({ ...vuelo, ...ar, pickupGroupId: "recorrida-1" });
    mocks.findFlights.mockResolvedValue([ar, ja]);
  });

  it("lleva la combi y el chofer a los dos vuelos y no quita las otras: la recorrida puede ir con dos trafics", async () => {
    const url = await redirectTo(assignVehicleAction(undefined, form({ flightId: "f1", vehicleId: "v1", driverId: "d1" })));
    // La nave va a los dos vuelos de la vuelta…
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { flightId: "f1", vehicleId: "v1", driverId: "d1" } }));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { flightId: "f2", vehicleId: "v1", driverId: "d1" } }));
    // …y la combi que ya tenía la recorrida se queda: la hoja reparte a los pasajeros entre las dos.
    expect(mocks.deleteAssignments).not.toHaveBeenCalled();
    expect(mocks.findAssignments).toHaveBeenCalledWith(expect.objectContaining({ where: { flightId: { in: ["f2"] }, vehicleId: "v1" } }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      entityId: "f2", action: "CREATE", summary: expect.stringContaining("Combi Sprinter 1 asignada a la recorrida de AR1657")
    }));
    expect(url).toContain("recorrida AR1657 + JA3184");
    expect(url).not.toContain("se quitó");
  });

  it("si toda la recorrida ya iba con esa combi y ese chofer, no guarda nada", async () => {
    mocks.findAssignment.mockResolvedValue({ driverId: "d1" });
    mocks.findAssignments.mockResolvedValue([{ flightId: "f2" }]);
    expect(await assignVehicleAction(undefined, form({ flightId: "f1", vehicleId: "v1", driverId: "d1" }))).toEqual({ error: "La combi ya tenía ese chofer." });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("si al otro vuelo de la recorrida le falta la combi, se la agrega en vez de rechazar", async () => {
    mocks.findAssignment.mockResolvedValue({ driverId: "d1" });
    await redirectTo(assignVehicleAction(undefined, form({ flightId: "f1", vehicleId: "v1", driverId: "d1" })));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { flightId: "f2", vehicleId: "v1", driverId: "d1" } }));
    expect(mocks.deleteAssignments).not.toHaveBeenCalled();
  });

  it("el vuelo sin recorrida sigue con el mensaje de siempre y no consulta el grupo", async () => {
    mocks.findFlights.mockResolvedValue([]);
    const url = await redirectTo(assignVehicleAction(undefined, form({ flightId: "f1", vehicleId: "v1", driverId: "d1" })));
    expect(mocks.findAssignments).not.toHaveBeenCalled();
    expect(mocks.deleteAssignments).not.toHaveBeenCalled();
    expect(url).toBe("redirect:/admin/aeropuerto?date=2026-11-19&notice=Combi asignada al vuelo.");
  });

  it("desde el tablero (sólo la nave) no pisa el chofer que el otro vuelo de la recorrida ya tenía", async () => {
    await redirectTo(assignVehicleAction(undefined, form({ flightId: "f1", vehicleId: "v1" })));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { flightId_vehicleId: { flightId: "f2", vehicleId: "v1" } }, update: {}
    }));
    expect(mocks.findDriver).not.toHaveBeenCalled();
  });
});

describe("aeropuerto: quitar una combi de una recorrida", () => {
  const ar = { id: "f1", number: "AR1657", scheduledAt: new Date("2026-11-19T22:00:00-03:00"), pickupGroupId: "recorrida-1" };
  const ja = { id: "f2", number: "JA3184", scheduledAt: new Date("2026-11-19T22:13:00-03:00") };

  it("la saca de todos los vuelos de la recorrida, no sólo del que se tocó", async () => {
    mocks.findAssignment.mockResolvedValue({ vehicleId: "v1", flight: ar, vehicle: { name: "Trafic 1" }, driver: null });
    mocks.findAssignments.mockResolvedValue([{ id: "asig-ja", flight: ja }]);
    const url = await redirectTo(removeAssignmentAction(form({ id: "asig-ar" })));
    expect(mocks.findAssignments).toHaveBeenCalledWith(expect.objectContaining({
      where: { vehicleId: "v1", flight: { pickupGroupId: "recorrida-1" }, id: { not: "asig-ar" } }
    }));
    expect(mocks.deleteAssignments).toHaveBeenCalledWith({ where: { id: { in: ["asig-ar", "asig-ja"] } } });
    expect(mocks.auditAfterCommit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      entityId: "f2", action: "DELETE", summary: expect.stringContaining("quitada de la recorrida de AR1657")
    }));
    expect(url.replace(/\+/g, " ")).toContain("Combi quitada del vuelo.");
  });

  it("en un vuelo suelto sólo borra esa asignación", async () => {
    mocks.findAssignment.mockResolvedValue({ vehicleId: "v1", flight: { ...ar, pickupGroupId: null }, vehicle: { name: "Trafic 1" }, driver: null });
    await redirectTo(removeAssignmentAction(form({ id: "asig-ar" })));
    expect(mocks.findAssignments).not.toHaveBeenCalled();
    expect(mocks.deleteAssignments).toHaveBeenCalledWith({ where: { id: { in: ["asig-ar"] } } });
  });
});
