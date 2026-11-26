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
  it.each(["RETIRADO", "REVISAR"])("mantiene fuera de la oferta un vuelo %s aun con lecturas en vivo", async source => {
    const bloqueado = { ...live, id: "protegido", source, _count: { reservations: 1, assignments: 1 } };
    m.api.mockResolvedValueOnce({ flights: [live], error: null });
    m.findFirst.mockResolvedValueOnce(bloqueado);
    m.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([bloqueado]);
    m.fids.mockResolvedValueOnce({ flights: [{ number: live.number, airlineCode: "JA", scheduled: "12:22", city: "AEP", statusText: "En vuelo" }], error: null });
    await syncAirportFlights();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.createMany).not.toHaveBeenCalled();
    expect(m.delete).not.toHaveBeenCalled();
    expect(m.obs.mock.calls[0][0].data[0].syncOutcome).toBe("PENDIENTE_DE_CONFIRMACION");
  });

  it("una hora temprana que FIDS anticipa para mañana queda sólo como observación", async () => {
    vi.setSystemTime(new Date("2026-11-14T22:00:00Z"));
    m.fids.mockResolvedValueOnce({ flights: [{ number: "AR1652", airlineCode: "AR", scheduled: "08:00", city: "AEP", statusText: "Programado" }], error: null });
    await syncAirportFlights();
    expect(m.createMany).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.obs.mock.calls[0][0].data[0]).toMatchObject({ localDay: "2026-11-15", syncOutcome: "FECHA_FUTURA_INFERIDA" });
  });

  it("la lectura del día actualiza el estado y conserva el horario y los aeropuertos publicados", async () => {
    const previo = { ...live, id: "publicado", source: "JA_OFICIAL", scheduledAt: new Date("2026-11-14T16:00:00Z"), status: "SCHEDULED" };
    m.findFirst.mockResolvedValueOnce(previo);
    m.api.mockResolvedValueOnce({ flights: [live], error: null });
    await syncAirportFlights();
    const data = m.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "EN_ROUTE", scheduledAt: previo.scheduledAt });
    expect(data).not.toHaveProperty("source");
    expect(data).not.toHaveProperty("origin");
    expect(data).not.toHaveProperty("destination");
  });

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

  it("el tablero no descarta un vuelo por cercanía con otra aerolínea (AR1657 no es AJ325)", async () => {
    m.fids.mockResolvedValueOnce({ flights: [{ number: "AR1657", airlineCode: "AR", scheduled: "12:30", estimated: null, city: "Buenos Aires", statusText: "Programado", statusClass: "" }], error: null });
    // La base sólo tiene un American Jet a 15 minutos: una búsqueda sin filtro de aerolínea lo encuentra.
    const aj = { id: "aj", number: "AJ325", airline: "AJ", direction: "ARRIVAL", scheduledAt: new Date("2026-11-14T15:15:00Z") };
    m.findFirst.mockImplementation(async (args: { where?: { airline?: { in?: string[] } } }) =>
      !args?.where?.airline || args.where.airline.in?.includes(aj.airline) ? aj : null
    );
    await syncAirportFlights();
    expect(m.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ airline: { in: ["AR"] } }) }));
    expect(m.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ number: "AR1657", source: "FIDS" }) }));
    const [lectura] = m.obs.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(lectura).toMatchObject({ source: "FIDS", syncOutcome: "CREADO", dayInferred: true, localDay: "2026-11-14" });
  });

  it("un descarte por cercanía que deja el vuelo fuera de la grilla queda como discrepancia", async () => {
    m.fids.mockResolvedValueOnce({ flights: [{ number: "AR1650", airlineCode: "AR", scheduled: "12:30", estimated: null, city: "Buenos Aires", statusText: "Programado", statusClass: "" }], error: null });
    m.findFirst.mockResolvedValueOnce({ id: "ar", number: "AR1657", airline: "AR", direction: "ARRIVAL", scheduledAt: new Date("2026-11-14T15:15:00Z") });
    await syncAirportFlights();
    const [lectura] = m.obs.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(lectura).toMatchObject({ syncOutcome: "DESCARTADO_GEMELO", matchLevel: "SIN_VUELO" });
    expect(lectura.discrepancy).toMatch(/AR1650 no quedó en la grilla/);
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
