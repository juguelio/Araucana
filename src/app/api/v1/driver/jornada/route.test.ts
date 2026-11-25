import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ usuario: vi.fn(), jornada: vi.fn(), firma: vi.fn() }));
vi.mock("@/lib/auth/service", async (original) => ({ ...await original<typeof import("@/lib/auth/service")>(), requireDriverUser: mocks.usuario }));
vi.mock("@/lib/driver/jornada-app", () => ({ cargarJornadaApp: mocks.jornada }));
vi.mock("@/lib/driver/comprobante", () => ({ firmarServicio: mocks.firma }));
import { GET } from "./route";
import { AuthorizationError } from "@/lib/auth/service";

it("usa sólo la identidad autenticada y entrega comprobantes del chofer", async () => {
  mocks.usuario.mockResolvedValue({ id: "d" });
  const servicio = { id: "salida-s1" };
  mocks.jornada.mockResolvedValue({ fecha: "2026-11-25", servicios: [servicio] });
  mocks.firma.mockReturnValue("firma");
  const res = await GET(new Request("https://example.test/api/v1/driver/jornada?driverId=otro"));
  expect(mocks.jornada).toHaveBeenCalledWith("d");
  expect(mocks.firma).toHaveBeenCalledWith("d", servicio);
  expect(await res.json()).toEqual({ driverId: "d", fecha: "2026-11-25", servicios: [{ ...servicio, comprobante: "firma" }] });
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(res.headers.get("x-driver-id")).toBe("d");
});

it("requiere una sesión de chofer antes de acceder a las asignaciones", async () => {
  mocks.jornada.mockClear();
  mocks.usuario.mockRejectedValueOnce(new AuthorizationError());
  const res = await GET(new Request("https://example.test/api/v1/driver/jornada"));
  expect(res.status).toBe(401);
  expect(mocks.jornada).not.toHaveBeenCalled();
});
