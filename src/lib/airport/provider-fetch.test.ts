import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchSchedules } from "./provider";
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-15T02:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("no consulta fechas futuras en una API de ventana en vivo", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect((await fetchSchedules("ARRIVAL", "2026-11-15", "fake")).error).toMatch(/futura/);
  expect(fetcher).not.toHaveBeenCalled();
});
it("filtra por día argentino y no envía un parámetro date sin soporte", async () => {
  const row = (iso: string, number: string) => ({ flight_iata: number, dep_iata: "AEP", arr_time_ts: Date.parse(iso) / 1000, status: "scheduled" });
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ response: [row("2026-11-15T02:30:00Z", "AR1"), row("2026-11-15T03:30:00Z", "AR2")] }) });
  vi.stubGlobal("fetch", fetcher);
  const result = await fetchSchedules("ARRIVAL", "2026-11-14", "fake");
  expect(result.flights.map((f) => f.number)).toEqual(["AR1"]);
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.has("date")).toBe(false);
});
