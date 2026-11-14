import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { syncAirportFlights } from "./sync";
const m = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn(), createMany: vi.fn(), api: vi.fn(), fids: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { flight: { findMany: m.findMany, findFirst: m.findFirst, count: m.count, update: m.update, createMany: m.createMany } } }));
vi.mock("@/lib/settings/app-settings", () => ({ getAirLabsKey: async () => "test-key" }));
vi.mock("./provider", () => ({ fetchSchedules: m.api }));
vi.mock("./fids", async (original) => ({ ...await original<typeof import("./fids")>(), fetchFidsBoard: m.fids }));
const live = { number: "JA3183", airline: "JA", origin: "AEP", destination: "CPC", direction: "ARRIVAL", scheduledAt: new Date("2026-11-14T15:22:00Z"), estimatedAt: null, status: "EN_ROUTE", externalId: "test" };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-14T14:22:00Z"));
  m.findMany.mockResolvedValue([]); m.findFirst.mockResolvedValue(null); m.count.mockResolvedValue(0);
  m.update.mockResolvedValue({}); m.createMany.mockResolvedValue({ count: 1 });
  m.api.mockResolvedValue({ flights: [], error: null }); m.fids.mockResolvedValue({ flights: [], error: null });
});
afterEach(() => vi.useRealTimers());
describe("sincronización con fuentes de distinta calidad", () => {
  it("reemplaza el aterrizaje FIDS erróneo y el horario viejo con una lectura API fechada", async () => {
    m.api.mockResolvedValueOnce({ flights: [live], error: null });
    m.findFirst.mockResolvedValueOnce({ ...live, id: "existing", source: "FIDS", status: "LANDED", scheduledAt: new Date("2026-11-14T15:05:00Z") });
    await syncAirportFlights({ days: 30 });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "existing" }, data: expect.objectContaining({ source: "API", status: "EN_ROUTE", scheduledAt: live.scheduledAt }) }));
    expect(m.api).toHaveBeenCalledTimes(2);
    expect(m.api.mock.calls.every((args) => args[1] === "2026-11-14")).toBe(true);
  });
  it("un tablero sin fecha no pisa la API consultada el mismo día", async () => {
    m.fids.mockResolvedValueOnce({ flights: [{ number: "JA3183", airlineCode: "JA", scheduled: "12:22", estimated: null, city: "AEP", statusText: "En Vuelo", statusClass: "arribado" }], error: null });
    m.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...live, id: "api", source: "API", lastCheckedAt: new Date(), _count: { reservations: 0, assignments: 0 } }]);
    await syncAirportFlights();
    expect(m.update).not.toHaveBeenCalled(); expect(m.createMany).not.toHaveBeenCalled();
  });
  it("una consulta del viernes a las 19 no crea el vuelo del sábado", async () => {
    vi.setSystemTime(new Date("2026-11-13T22:00:00Z"));
    m.fids.mockResolvedValueOnce({ flights: [{ number: "JA3181", airlineCode: "JA", scheduled: "12:04", estimated: "17:10", city: "EZE", statusText: "Arribado", statusClass: "arribado" }], error: null });
    await syncAirportFlights();
    expect(m.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ scheduledAt: new Date("2026-11-13T15:04:00Z"), source: "FIDS" }) }));
  });
});
