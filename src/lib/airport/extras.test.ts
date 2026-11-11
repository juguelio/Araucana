import { describe, expect, it } from "vitest";
import { airportExtrasBreakdown } from "./extras";
import { airportPickupZoneOf, chargesZoneExtra, type AirportCoverage } from "./pickup-zone";

const coverage: AirportCoverage = {
  enabled: true,
  boundary: [[-40.17, -71.37], [-40.17, -71.30], [-40.13, -71.30], [-40.13, -71.37]],
  extraBoundary: [[-40.25, -71.45], [-40.25, -71.20], [-40.05, -71.20], [-40.05, -71.45]],
  exclusions: [[[-40.16, -71.36], [-40.16, -71.35], [-40.15, -71.35], [-40.15, -71.36]]]
};

describe("zonas del aeropuerto", () => {
  it("distingue zona verde, zona con recargo, excluidos y fuera de cobertura", () => {
    expect(airportPickupZoneOf([-40.14, -71.32], coverage)).toBe("BASE");
    expect(airportPickupZoneOf([-40.10, -71.25], coverage)).toBe("EXTRA");
    expect(airportPickupZoneOf([-40.155, -71.355], coverage)).toBeNull();
    expect(airportPickupZoneOf([-39.9, -71.0], coverage)).toBeNull();
  });

  it("sin segundo límite todo lo de afuera del verde queda fuera", () => {
    expect(airportPickupZoneOf([-40.10, -71.25], { ...coverage, extraBoundary: [] })).toBeNull();
  });

  it("el recargo sólo corre con el mapa aplicado", () => {
    expect(chargesZoneExtra([-40.10, -71.25], coverage)).toBe(true);
    expect(chargesZoneExtra([-40.10, -71.25], { ...coverage, enabled: false })).toBe(false);
    expect(chargesZoneExtra(null, coverage)).toBe(false);
  });
});

describe("extras del traslado", () => {
  it("suma recargo de zona y equipaje por bulto", () => {
    expect(airportExtrasBreakdown({ zoneExtra: true, sportsLuggageCount: 3 }, { zoneExtraCents: 500000, sportsLuggageCents: 200000 })).toEqual({
      zoneExtraCents: 500000,
      sportsLuggageCount: 3,
      sportsLuggageUnitCents: 200000,
      sportsLuggageTotalCents: 600000,
      totalCents: 1100000
    });
  });

  it("ignora cantidades inválidas", () => {
    expect(airportExtrasBreakdown({ zoneExtra: false, sportsLuggageCount: -2 }, { zoneExtraCents: 1, sportsLuggageCents: 1 }).totalCents).toBe(0);
  });
});
