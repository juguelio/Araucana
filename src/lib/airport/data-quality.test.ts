import { describe, expect, it } from "vitest";
import { flightEvidenceWarning, reliableEstimate, airportLocalDay } from "./data-quality";
import { separarVuelosDelTablero } from "./flight-board";
import { motivoNoReservable } from "./booking";

const now = new Date("2026-11-14T14:22:00Z");
const flight = { source: "FIDS", direction: "ARRIVAL" as const, status: "LANDED", scheduledAt: new Date("2026-11-14T15:22:00Z"), estimatedAt: new Date("2026-11-14T03:00:00Z"), lastCheckedAt: new Date("2026-11-14T14:02:00Z") };
describe("evidencia del tablero observado el 14 de noviembre", () => {
  it("00:00 no es una estima ni prueba de aterrizaje antes de las 11:22", () => {
    expect(reliableEstimate(flight)).toBeNull();
    expect(flightEvidenceWarning(flight, now)).toMatch(/incompatible/);
    expect(flightEvidenceWarning(flight, new Date("2026-11-14T21:00:00Z"))).toMatch(/incompatible/);
    expect(separarVuelosDelTablero([flight], now).porVerificar).toEqual([flight]);
    expect(motivoNoReservable(flight, 24, now)).toMatch(/verificación/);
  });
  it("el vuelo del viernes trasladado al sábado se aísla aun si dice demorado", () => {
    const stale = { ...flight, status: "DELAYED", lastCheckedAt: new Date("2026-11-13T22:00:00Z") };
    expect(flightEvidenceWarning(stale, now)).toMatch(/Fecha sin confirmar/);
    expect(separarVuelosDelTablero([stale], now).terminados).toEqual([]);
    expect(motivoNoReservable(stale, 24, now)).toMatch(/verificación/);
  });
  it("permite una llegada temprana con hora real informada", () => {
    expect(flightEvidenceWarning({ ...flight, actualAt: new Date("2026-11-14T14:00:00Z") }, now)).toBeNull();
  });
  it("no descarta medianoche de una fuente con fecha y respeta UTC-3", () => {
    expect(reliableEstimate({ ...flight, source: "API" })).toBe(flight.estimatedAt);
    expect(airportLocalDay(new Date("2026-11-15T02:00:00Z"))).toBe("2026-11-14");
  });
});
