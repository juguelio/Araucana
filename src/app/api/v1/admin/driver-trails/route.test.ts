import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { findMany, requireAdminApi } = vi.hoisted(() => ({ findMany: vi.fn(), requireAdminApi: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { driverLocationSample: { findMany } } }));
vi.mock("../_utils", () => ({ requireAdminApi }));
vi.mock("@/lib/api/responses", () => ({
  handleApiError: (error: { status?: number }) => Response.json({ error: "denegado" }, { status: error.status ?? 500 })
}));

beforeEach(() => { vi.clearAllMocks(); findMany.mockResolvedValue([]); requireAdminApi.mockResolvedValue({ id: "admin" }); });

describe("GET driver-trails", () => {
  it.each([["", 8], ["?horas=", 8], ["?horas=Infinity", 8], ["?horas=NaN", 8], ["?horas=no", 8],
    ["?horas=-5", 1], ["?horas=0", 1], ["?horas=1.6", 2], ["?horas=24", 24], ["?horas=999", 24]])(
    "devuelve la ventana realmente consultada: %s", async (query, horas) => {
      const request = new Request(`http://localhost/api/v1/admin/driver-trails${query}`);
      const response = await GET(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ recorridos: [], horas, truncado: false });
      expect(requireAdminApi).toHaveBeenCalledWith(request);
      const filtro = findMany.mock.calls[0][0].where.recordedAt;
      expect(filtro.lte.getTime() - filtro.gte.getTime()).toBe(horas * 3_600_000);
    }
  );
  it.each([401, 403])("no consulta posiciones sin autorización (%s)", async status => {
    requireAdminApi.mockRejectedValueOnce({ status });
    const response = await GET(new Request("http://localhost/api/v1/admin/driver-trails"));
    expect(response.status).toBe(status);
    expect(findMany).not.toHaveBeenCalled();
  });
  it("propaga fallos de lectura al manejador de errores", async () => {
    findMany.mockRejectedValueOnce(new Error("db"));
    expect((await GET(new Request("http://localhost/api/v1/admin/driver-trails"))).status).toBe(500);
  });
});
