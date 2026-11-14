import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findSchedule: vi.fn(),
  findVehicle: vi.fn(),
  updateSchedule: vi.fn(),
  lockFleet: vi.fn(),
  fleetConflicts: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("@/lib/auth/admin", () => ({ getCurrentAdminOrRedirect: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    schedule: { findUnique: mocks.findSchedule },
    vehicle: { findUnique: mocks.findVehicle },
    $transaction: (run: (tx: unknown) => unknown) => run({ schedule: { update: mocks.updateSchedule } })
  }
}));
vi.mock("@/lib/special-trips/conflicts", () => ({
  fleetConflicts: mocks.fleetConflicts,
  lockFleet: mocks.lockFleet,
  savePublicSchedule: mocks.save
}));

import { setScheduleVehicleAction } from "./actions";

const salida = {
  id: "s1",
  routeId: "r1",
  vehicleId: "v1",
  departureAt: new Date("2026-11-20T12:00:00-03:00"),
  arrivalAt: new Date("2026-11-20T15:00:00-03:00"),
  route: { slug: "sma-bariloche" }
};

/** La acción siempre termina en redirect(): se captura la URL que pidió. */
async function redirectTo(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
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
  mocks.auth.mockResolvedValue({ id: "staff" });
  mocks.findSchedule.mockResolvedValue(salida);
  mocks.findVehicle.mockResolvedValue({ isActive: true });
  mocks.fleetConflicts.mockResolvedValue([]);
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`redirect:${url}`);
  });
});

describe("reasignar la nave desde el calendario (issue #81)", () => {
  it("exige autorización antes de leer o escribir", async () => {
    mocks.auth.mockRejectedValue(new Error("auth-denied"));
    await expect(setScheduleVehicleAction(form({ id: "s1", vehicleId: "v2" }))).rejects.toThrow("auth-denied");
    expect(mocks.findSchedule).not.toHaveBeenCalled();
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
  });

  it("no cambia nada si la nave ya está tomada en ese horario y avisa por qué", async () => {
    mocks.fleetConflicts.mockResolvedValue([
      { id: "s2", label: "Servicio público · SMA → Bariloche", href: "/admin/rutas/r1/salidas/s2", possible: false }
    ]);

    const message = await redirectTo(setScheduleVehicleAction(form({ id: "s1", vehicleId: "v2" })));

    expect(mocks.updateSchedule).not.toHaveBeenCalled();
    expect(decodeURIComponent(message)).toContain("No se cambió la nave");
    expect(decodeURIComponent(message)).toContain("Servicio público · SMA → Bariloche");
    // La propia salida queda afuera del chequeo: si no, cualquier cambio chocaría consigo mismo.
    expect(mocks.fleetConflicts).toHaveBeenCalledWith(
      expect.anything(),
      { vehicleId: "v2", startsAt: salida.departureAt, endsAt: salida.arrivalAt },
      undefined,
      "s1"
    );
  });

  it("cambia sólo la nave y vuelve al mes del calendario", async () => {
    const message = await redirectTo(setScheduleVehicleAction(form({ id: "s1", vehicleId: "v2" })));

    expect(mocks.updateSchedule).toHaveBeenCalledWith({ where: { id: "s1" }, data: { vehicleId: "v2" } });
    expect(mocks.refresh).toHaveBeenCalledWith("/admin/rutas/r1/salidas");
    expect(decodeURIComponent(message)).toBe("redirect:/admin/rutas/r1/salidas?month=2026-11&notice=Nave de la salida actualizada.");
  });

  it("no escribe si la salida ya tiene esa nave", async () => {
    const message = await redirectTo(setScheduleVehicleAction(form({ id: "s1", vehicleId: "v1" })));

    expect(mocks.updateSchedule).not.toHaveBeenCalled();
    expect(decodeURIComponent(message)).toContain("ya tiene esa nave");
  });

  it("rechaza una nave inactiva o inexistente", async () => {
    mocks.findVehicle.mockResolvedValue({ isActive: false });
    const inactiva = await redirectTo(setScheduleVehicleAction(form({ id: "s1", vehicleId: "v2" })));
    expect(decodeURIComponent(inactiva)).toContain("no está disponible");

    mocks.findVehicle.mockResolvedValue(null);
    const inexistente = await redirectTo(setScheduleVehicleAction(form({ id: "s1", vehicleId: "v2" })));
    expect(decodeURIComponent(inexistente)).toContain("no está disponible");
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
  });

  it("vuelve al listado de rutas si la salida ya no existe", async () => {
    mocks.findSchedule.mockResolvedValue(null);
    const message = await redirectTo(setScheduleVehicleAction(form({ id: "s1", vehicleId: "v2" })));

    expect(decodeURIComponent(message)).toContain("redirect:/admin/rutas?notice=");
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
  });
});
