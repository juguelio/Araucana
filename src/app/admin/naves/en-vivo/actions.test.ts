import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const revalidatePath = vi.fn();
const fleetConflicts = vi.fn();
const updateSchedule = vi.fn();
const createAssignment = vi.fn();
const updateAssignment = vi.fn();
const findSchedule = vi.fn();
const findFlight = vi.fn();
const findVehicle = vi.fn();
const findUser = vi.fn();
const recordEntityAudit = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock("@/lib/auth/admin", () => ({ getCurrentAdminOrRedirect: async () => ({ id: "admin-1", role: "ADMIN" }) }));
vi.mock("@/lib/special-trips/conflicts", () => ({
  lockFleet: async () => undefined,
  fleetConflicts: (...args: unknown[]) => fleetConflicts(...args)
}));
vi.mock("@/lib/audit/schedule", () => ({ recordScheduleAudit: async () => undefined }));
vi.mock("@/lib/audit/entity", () => ({ recordEntityAudit: (...args: unknown[]) => recordEntityAudit(...args) }));
vi.mock("@/lib/booking/schedule-vehicle", () => ({ vehicleConflictNotice: (c: Array<{ label: string }>) => `Conflicto: ${c.map((x) => x.label).join(", ")}` }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    schedule: { findUnique: (...args: unknown[]) => findSchedule(...args) },
    flight: { findUnique: (...args: unknown[]) => findFlight(...args) },
    vehicle: { findUnique: (...args: unknown[]) => findVehicle(...args) },
    user: { findUnique: (...args: unknown[]) => findUser(...args) },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        schedule: {
          findUnique: (...args: unknown[]) => findSchedule(...args),
          update: (...args: unknown[]) => updateSchedule(...args)
        },
        airportVehicleAssignment: {
          create: (...args: unknown[]) => createAssignment(...args),
          updateMany: (...args: unknown[]) => updateAssignment(...args)
        }
      })
  }
}));

const { asignarUnidadAction } = await import("./actions");

const salida = {
  id: "sch_1",
  routeId: "route-1",
  vehicleId: "veh-old",
  driverId: null,
  departureAt: new Date("2026-11-22T01:00:00Z"),
  arrivalAt: new Date("2026-11-22T02:30:00Z"),
  status: "SCHEDULED",
  route: { slug: "sma-villa-traful" }
};

const vuelo = {
  id: "fl_9",
  number: "JA3051",
  direction: "ARRIVAL",
  scheduledAt: new Date("2026-11-21T20:05:00Z"),
  estimatedAt: null,
  pickupStartOverrideAt: null,
  pickupGroupId: null
};

function form(campos: Record<string, string>) {
  const data = new FormData();
  for (const [clave, valor] of Object.entries(campos)) data.set(clave, valor);
  return data;
}

describe("asignarUnidadAction: asignar desde Naves en vivo sin salir del mapa", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    createAssignment.mockReset().mockResolvedValue({ id: "asg_1" });
    updateAssignment.mockReset().mockResolvedValue({ count: 1 });
    fleetConflicts.mockReset().mockResolvedValue([]);
    updateSchedule.mockReset().mockResolvedValue({});
    findSchedule.mockReset().mockResolvedValue(salida);
    findFlight.mockReset().mockResolvedValue(vuelo);
    findVehicle.mockReset().mockResolvedValue({ isActive: true, name: "Sprinter 3" });
    findUser.mockReset().mockResolvedValue({ isActive: true, role: "DRIVER", name: "Ramón Paz", email: "ramon@araucana.test" });
    recordEntityAudit.mockReset().mockResolvedValue(undefined);
  });

  it("vuelo suelto: crea la asignación y se queda en el mapa con el mensaje", async () => {
    await expect(
      asignarUnidadAction(form({ servicioId: "vuelo-fl_9", vehicleId: "veh-9", driverId: "drv-1", fecha: "2026-11-21" }))
    ).rejects.toThrow("/admin/naves/en-vivo?vista=en-vivo&fecha=2026-11-21&ok=Combi+Sprinter+3+asignada+al+vuelo+JA3051.");

    expect(createAssignment).toHaveBeenCalledWith({
      data: { flightId: "fl_9", vehicleId: "veh-9", driverId: "drv-1", createdBy: "admin-1" }
    });
    expect(recordEntityAudit).toHaveBeenCalled();
  });

  it("vuelo existente: cambia la combi en la misma asignación y vuelve a Servicios del día", async () => {
    await expect(
      asignarUnidadAction(
        form({
          servicioId: "vuelo-fl_9",
          vehicleId: "veh-9",
          driverId: "drv-1",
          fecha: "2026-11-21",
          vista: "servicios",
          assignmentId: "asg_1"
        })
      )
    ).rejects.toThrow(
      "/admin/naves/en-vivo?vista=servicios&fecha=2026-11-21&ok=Combi+Sprinter+3+reasignada+al+vuelo+JA3051."
    );

    expect(updateAssignment).toHaveBeenCalledWith({
      where: { id: "asg_1", flightId: "fl_9" },
      data: { vehicleId: "veh-9", driverId: "drv-1" }
    });
    expect(fleetConflicts).toHaveBeenCalledWith(expect.anything(), expect.anything(), undefined, undefined, "asg_1");
    expect(createAssignment).not.toHaveBeenCalled();
  });

  it("vuelo en recorrida: manda al tablero del aeropuerto con el modal de ese vuelo, sin partir el grupo", async () => {
    findFlight.mockResolvedValue({ ...vuelo, pickupGroupId: "grupo-1" });

    await expect(
      asignarUnidadAction(form({ servicioId: "vuelo-fl_9", vehicleId: "veh-9", fecha: "2026-11-21" }))
    ).rejects.toThrow("/admin/aeropuerto?");

    expect(createAssignment).not.toHaveBeenCalled();
    const url = redirectMock.mock.calls[0][0];
    expect(url).toContain("naves=fl_9");
    expect(url).toContain("date=");
  });

  it("vuelo con la combi tomada: no crea nada y explica el conflicto", async () => {
    fleetConflicts.mockResolvedValue([{ label: "Vuelo AR 1838" }]);

    await expect(
      asignarUnidadAction(form({ servicioId: "vuelo-fl_9", vehicleId: "veh-9", fecha: "2026-11-21" }))
    ).rejects.toThrow("error=Conflicto%3A+Vuelo+AR+1838");

    expect(createAssignment).not.toHaveBeenCalled();
  });

  it("salida desde Servicios del día: vuelve a la misma vista", async () => {
    await expect(
      asignarUnidadAction(form({ servicioId: "salida-sch_1", vehicleId: "veh-2", driverId: "drv-2", fecha: "2026-11-21", vista: "servicios", page: "2" }))
    ).rejects.toThrow("/admin/naves/en-vivo?vista=servicios&fecha=2026-11-21&page=2&ok=Nave+y+chofer+asignados+a+la+salida.");

    expect(updateSchedule).toHaveBeenCalledWith({ where: { id: "sch_1" }, data: { vehicleId: "veh-2", driverId: "drv-2" } });
  });

  it("salida desde Servicio público: vuelve a la boletería del día, no a Naves en vivo", async () => {
    await expect(
      asignarUnidadAction(
        form({
          servicioId: "salida-sch_1",
          vehicleId: "veh-2",
          driverId: "drv-2",
          fecha: "2026-11-24",
          returnTo: "/admin/servicio-publico?vista=dia&fecha=2026-11-24"
        })
      )
    ).rejects.toThrow("/admin/servicio-publico?vista=dia&fecha=2026-11-24&ok=Nave+y+chofer+asignados+a+la+salida.");

    expect(updateSchedule).toHaveBeenCalledWith({ where: { id: "sch_1" }, data: { vehicleId: "veh-2", driverId: "drv-2" } });
  });

  it("salida: cambia nave y chofer de la salida del día", async () => {
    await expect(
      asignarUnidadAction(form({ servicioId: "salida-sch_1", vehicleId: "veh-2", driverId: "drv-2", fecha: "2026-11-21" }))
    ).rejects.toThrow("ok=Nave+y+chofer+asignados+a+la+salida.");

    expect(updateSchedule).toHaveBeenCalledWith({ where: { id: "sch_1" }, data: { vehicleId: "veh-2", driverId: "drv-2" } });
  });

  it("salida: si la unidad está tomada a esa hora, no guarda y explica el conflicto", async () => {
    fleetConflicts.mockResolvedValue([{ label: "Salida 19:00 SMA → Traful" }]);

    await expect(
      asignarUnidadAction(form({ servicioId: "salida-sch_1", vehicleId: "veh-2", fecha: "2026-11-21" }))
    ).rejects.toThrow("error=Conflicto%3A+Salida+19%3A00+SMA+%E2%86%92+Traful");

    expect(updateSchedule).not.toHaveBeenCalled();
  });

  it("salida: no acepta una nave inactiva", async () => {
    findVehicle.mockResolvedValue({ isActive: false, name: "Vieja" });

    await expect(
      asignarUnidadAction(form({ servicioId: "salida-sch_1", vehicleId: "veh-2", fecha: "2026-11-21" }))
    ).rejects.toThrow("error=Esa+nave+no+est%C3%A1+disponible");

    expect(updateSchedule).not.toHaveBeenCalled();
  });

  it("chapelco y especiales se derivan a su tablero", async () => {
    await expect(
      asignarUnidadAction(form({ servicioId: "chapelco-dia1", vehicleId: "veh-2", fecha: "2026-11-21" }))
    ).rejects.toThrow("error=Chapelco+y+los+viajes+especiales+se+asignan+desde+su+propio+tablero.");

    expect(updateSchedule).not.toHaveBeenCalled();
    expect(createAssignment).not.toHaveBeenCalled();
  });

  it("un id que no es de servicio no intenta escribir nada", async () => {
    await expect(asignarUnidadAction(form({ servicioId: "cosa-1", vehicleId: "veh-2" }))).rejects.toThrow(
      "error=No+se+reconoci%C3%B3+el+servicio"
    );
  });
});
