import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { syncAirportFlights } from "./sync";
const m = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn(), updateMany: vi.fn(), createMany: vi.fn(), delete: vi.fn(), airports: vi.fn(), api: vi.fn(), fids: vi.fn(), reservas: vi.fn(), reservasUpd: vi.fn(), obs: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { flight: { findMany: m.findMany, findFirst: m.findFirst, count: m.count, update: m.update, updateMany: m.updateMany, createMany: m.createMany, delete: m.delete }, flightObservation: { createMany: m.obs }, airportReservationDetails: { findMany: m.airports }, reservation: { findMany: m.reservas, updateMany: m.reservasUpd } } }));
vi.mock("@/lib/settings/app-settings", () => ({ getAirLabsKey: async () => "test-key" }));
vi.mock("./provider", () => ({ fetchSchedules: m.api }));
vi.mock("./fids", async (original) => ({ ...await original<typeof import("./fids")>(), fetchFidsBoard: m.fids }));
const live = { number: "JA3183", airline: "JA", origin: "AEP", destination: "CPC", direction: "ARRIVAL", scheduledAt: new Date("2026-11-14T15:22:00Z"), estimatedAt: null, status: "EN_ROUTE", externalId: "test" };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-14T14:22:00Z"));
  m.findMany.mockResolvedValue([]); m.findFirst.mockResolvedValue(null); m.count.mockResolvedValue(0);
  m.update.mockResolvedValue({}); m.updateMany.mockResolvedValue({ count: 0 }); m.createMany.mockResolvedValue({ count: 1 }); m.reservas.mockResolvedValue([]); m.reservasUpd.mockResolvedValue({ count: 0 }); m.delete.mockResolvedValue({}); m.airports.mockResolvedValue([]); m.obs.mockImplementation(async ({ data }) => ({ count: data.length }));
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
  it("un tablero sin fecha no pisa el HORARIO de la API consultada el mismo día", async () => {
    m.fids.mockResolvedValueOnce({ flights: [{ number: "JA3183", airlineCode: "JA", scheduled: "12:22", estimated: null, city: "AEP", statusText: "En Vuelo", statusClass: "arribado" }], error: null });
    m.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...live, id: "api", source: "API", lastCheckedAt: new Date(), _count: { reservations: 0, assignments: 0 } }]);
    await syncAirportFlights();
    // Mismo estado que ya tenia: no hay nada que escribir.
    expect(m.update).not.toHaveBeenCalled(); expect(m.createMany).not.toHaveBeenCalled();
  });
  it("el tablero SI actualiza el estado de un vuelo que vino de la API", async () => {
    // AirLabs trae el vuelo de CPC con su horario y despues nunca lo confirma. El aeropuerto si:
    // sin esto el tablero mostraba «Programado» un vuelo que habia aterrizado hacia horas.
    m.fids.mockResolvedValueOnce({ flights: [{ number: "JA3183", airlineCode: "JA", scheduled: "12:22", estimated: null, city: "AEP", statusText: "Aterrizado", statusClass: "arribado" }], error: null });
    m.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...live, id: "api", source: "API", status: "SCHEDULED", lastCheckedAt: new Date(), _count: { reservations: 0, assignments: 0 } }]);
    await syncAirportFlights();
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "api" }, data: expect.objectContaining({ status: "LANDED" }) }));
  });
  it("el tablero no hace retroceder un vuelo ya aterrizado", async () => {
    m.fids.mockResolvedValueOnce({ flights: [{ number: "JA3183", airlineCode: "JA", scheduled: "12:22", estimated: null, city: "AEP", statusText: "En Vuelo", statusClass: "arribado" }], error: null });
    m.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...live, id: "api", source: "API", status: "LANDED", lastCheckedAt: new Date(), _count: { reservations: 0, assignments: 0 } }]);
    await syncAirportFlights();
    expect(m.update).not.toHaveBeenCalled();
  });
  it("una consulta del viernes a las 19 no crea el vuelo del sábado", async () => {
    vi.setSystemTime(new Date("2026-11-13T22:00:00Z"));
    m.fids.mockResolvedValueOnce({ flights: [{ number: "JA3181", airlineCode: "JA", scheduled: "12:04", estimated: "17:10", city: "EZE", statusText: "Arribado", statusClass: "arribado" }], error: null });
    await syncAirportFlights();
    expect(m.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ scheduledAt: new Date("2026-11-13T15:04:00Z"), source: "FIDS" }) }));
  });
});

describe("registro de observaciones por fuente (modo sombra)", () => {
  const crudo = (over: Record<string, unknown>) => ({
    flight_iata: "JA3183", airline_iata: "JA", dep_iata: "AEP", arr_iata: "CPC",
    arr_time_ts: live.scheduledAt.getTime() / 1000, status: "active", ...over
  });

  it("guarda las lecturas crudas de AirLabs, incluidos los códigos compartidos que la normalización descarta", async () => {
    m.api.mockResolvedValueOnce({
      flights: [live],
      error: null,
      raw: [crudo({}), crudo({ flight_iata: "LA7711", airline_iata: "LA", cs_flight_iata: "JA3183" })]
    });
    m.findFirst.mockResolvedValueOnce({ ...live, id: "existing", source: "API", status: "EN_ROUTE" });
    m.findMany.mockImplementation(async (args: { select?: { origin?: boolean } }) =>
      args?.select?.origin ? [{ id: "existing", number: "JA3183", airline: "JA", origin: "AEP", direction: "ARRIVAL", scheduledAt: live.scheduledAt }] : []
    );
    const r = await syncAirportFlights();
    const data = m.obs.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(data).toEqual([
      expect.objectContaining({ source: "API", rawNumber: "JA3183", syncOutcome: "ACTUALIZADO", flightId: "existing", matcherFlightId: "existing", matchLevel: "EXACTO", discrepancy: null }),
      expect.objectContaining({ source: "API", rawNumber: "LA7711", codeshareOf: "JA3183", syncOutcome: "DESCARTADO_CODIGO_COMPARTIDO", matcherFlightId: "existing", matchLevel: "CODIGO_COMPARTIDO", discrepancy: null })
    ]);
    expect(new Set(data.map((d) => d.syncRunId)).size).toBe(1);
    expect(r.observaciones).toEqual({ registradas: 2, discrepancias: 0 });
  });

  it("una fila del tablero descartada por cercanía con otra aerolínea queda como discrepancia", async () => {
    m.fids.mockResolvedValueOnce({ flights: [{ number: "AR1657", airlineCode: "AR", scheduled: "12:30", estimated: null, city: "Buenos Aires", statusText: "Programado", statusClass: "" }], error: null });
    // el «gemelo» que hoy bloquea la fila es un American Jet a 15 minutos
    m.findFirst.mockResolvedValueOnce({ id: "aj", number: "AJ325", airline: "AJB", direction: "ARRIVAL", scheduledAt: new Date("2026-11-14T15:15:00Z") });
    await syncAirportFlights();
    const [lectura] = m.obs.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(lectura).toMatchObject({ source: "FIDS", syncOutcome: "DESCARTADO_GEMELO", dayInferred: true, localDay: "2026-11-14", matchLevel: "SIN_VUELO" });
    expect(lectura.discrepancy).toMatch(/AR1657 no quedó en la grilla/);
    expect(m.createMany).not.toHaveBeenCalled();
  });

  it("si no se pueden guardar las observaciones, la sincronización sigue igual", async () => {
    m.api.mockResolvedValueOnce({ flights: [live], error: null, raw: [crudo({})] });
    m.obs.mockRejectedValueOnce(new Error("tabla inexistente"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await syncAirportFlights();
    expect(r.creados).toBe(1);
    expect(r.errores).toEqual([]);
    expect(r.observaciones).toEqual({ registradas: 0, discrepancias: 0 });
    expect(warn).toHaveBeenCalled();
  });
});
