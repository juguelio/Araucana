import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usuario: vi.fn(), ventanas: vi.fn(), salidas: vi.fn(), vehiculos: vi.fn(), ubicacion: vi.fn()
}));
vi.mock("@/lib/auth/service", async (original) => ({ ...await original<typeof import("@/lib/auth/service")>(), requireDriverUser: mocks.usuario }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  vehicle: { findMany: mocks.vehiculos }, driverVehicleLocation: { findUnique: mocks.ubicacion }
} }));
vi.mock("@/lib/driver/jornada-app", () => ({ cargarVentanasGpsApp: mocks.ventanas }));
vi.mock("@/lib/driver/schedules", () => ({ listDriverUpcomingSchedules: mocks.salidas }));

import { GET } from "./route";

it("mantiene el formato del cliente anterior limitado a las unidades y recorridos del chofer", async () => {
  mocks.usuario.mockResolvedValue({ id: "d", name: "Chofer" });
  mocks.ventanas.mockResolvedValue([{ nave: { id: "v1" } }, { nave: null }]);
  mocks.salidas.mockResolvedValue([{ id: "s1", routeId: "r", route: { id: "r" } }]);
  mocks.vehiculos.mockResolvedValue([{ id: "v1", name: "Nave 1" }]);
  mocks.ubicacion.mockResolvedValue({ vehicleId: "anterior", vehicle: { name: "Nave de otro chofer" } });

  const res = await GET(new Request("https://example.test/api/v1/driver/bootstrap?driverId=otro"));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ vehicles: [{ id: "v1" }], schedules: [{ id: "s1" }], routes: [{ id: "r" }], currentLocation: null });
  expect(mocks.salidas.mock.calls[0][0]).toMatchObject({ driverId: "d", until: expect.any(Date), from: expect.any(Date) });
  expect(mocks.vehiculos.mock.calls[0][0].where).toEqual({ id: { in: ["v1"] } });
  expect(res.headers.get("cache-control")).toContain("no-store");
});
