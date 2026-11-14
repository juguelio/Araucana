import { describe, expect, it } from "vitest";
import { orderedRoundTrip, roundTripOrderValid, roundTripQuote } from "./round-trip-summary";
import type { AirportCoverage, PickupPoint } from "./pickup-zone";

const coverage: AirportCoverage = { enabled: true, boundary: [[0, 0], [0, 1], [1, 1], [1, 0]], extraBoundary: [[0, 0], [0, 3], [3, 3], [3, 0]], exclusions: [] };
const base: PickupPoint = [0.5, 0.5];
const extra: PickupPoint = [2, 2];
const input = {
  arrival: { priceCents: 10000, currency: "ARS", point: base },
  departure: { priceCents: 20000, currency: "ARS", point: base },
  passengerCount: 3, halfFareCount: 1, freeFareCount: 1, sportsLuggageCount: 2,
  coverage, extras: { zoneExtraCents: 5000, sportsLuggageCents: 1000 }
};

describe("cotización de ida y vuelta", () => {
  it.each([
    [base, base, 17000, 32000], [base, extra, 17000, 37000], [extra, extra, 22000, 37000]
  ] as const)("incluye recargos por tramo, menores y equipaje (%j, %j)", (arrivalPoint, departurePoint, a, d) => {
    const quote = roundTripQuote({ ...input, arrival: { ...input.arrival, point: arrivalPoint }, departure: { ...input.departure, point: departurePoint } });
    expect(quote.arrival.totalCents).toBe(a);
    expect(quote.departure.totalCents).toBe(d);
    expect(quote.totals).toEqual([{ currency: "ARS", amountCents: a + d }]);
  });
  it("no convierte dólares en pesos ni los suma", () => {
    const quote = roundTripQuote({ ...input, departure: { ...input.departure, currency: "USD" } });
    expect(quote.totals).toEqual([{ currency: "ARS", amountCents: 17000 }, { currency: "USD", amountCents: 32000 }]);
  });
  it("no aplica recargo cuando cobertura está deshabilitada", () => {
    const quote = roundTripQuote({ ...input, arrival: { ...input.arrival, point: extra }, coverage: { ...coverage, enabled: false }, sportsLuggageCount: 0 });
    expect(quote.arrival.totalCents).toBe(15000);
  });
});

describe("orden del viaje", () => {
  const early = { scheduledAt: "2030-01-01T12:00:00Z" };
  const late = { scheduledAt: "2030-01-01T20:00:00Z" };
  it("valida ambos órdenes y rechaza horarios iguales", () => {
    expect(roundTripOrderValid(early, late, "ARRIVAL")).toBe(true);
    expect(roundTripOrderValid(late, early, "DEPARTURE")).toBe(true);
    expect(roundTripOrderValid(early, early, "ARRIVAL")).toBe(false);
  });
  it("una demora puede invalidar la conexión", () => {
    expect(roundTripOrderValid({ ...early, estimatedAt: "2030-01-01T21:00:00Z" }, late, "ARRIVAL")).toBe(false);
  });
  it("la salida es la ida al salir primero y conserva su enlace", () => {
    expect(orderedRoundTrip({ code: "arrival" }, { code: "departure" }, "DEPARTURE")).toEqual([
      { label: "Ida · Salida", value: { code: "departure" } }, { label: "Vuelta · Llegada", value: { code: "arrival" } }
    ]);
  });
});
