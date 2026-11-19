import { describe, expect, it } from "vitest";
import { minimoDePasajeros, totalAlEditar, totalDerivadoCents, type ReservationPriceBasis } from "./reservation-edit";

const base: ReservationPriceBasis = {
  priceCents: 100000,
  passengerCount: 2,
  halfFareCount: 0,
  freeFareCount: 0,
  zoneExtraCents: 0,
  sportsLuggageCount: 0,
  sportsLuggageUnitCents: 0
};

describe("total de una reserva editada (#267)", () => {
  it("arma el total con la tarifa, la media tarifa y los adicionales guardados", () => {
    expect(totalDerivadoCents(base)).toBe(200000);
    expect(totalDerivadoCents({ ...base, halfFareCount: 1 })).toBe(150000);
    expect(totalDerivadoCents({ ...base, freeFareCount: 1 })).toBe(100000);
    expect(totalDerivadoCents({ ...base, zoneExtraCents: 25000, sportsLuggageCount: 2, sportsLuggageUnitCents: 8000 })).toBe(241000);
  });

  it("recalcula el total al cambiar la cantidad cuando el precio salió del cálculo", () => {
    expect(totalAlEditar({ basis: base, totalCents: 200000, passengerCount: 3 }))
      .toEqual({ totalCents: 300000, deltaCents: 100000, seRecalcula: true });
    expect(totalAlEditar({ basis: { ...base, passengerCount: 2, halfFareCount: 1 }, totalCents: 150000, passengerCount: 3 }))
      .toEqual({ totalCents: 250000, deltaCents: 100000, seRecalcula: true });
  });

  it("suma el equipaje deportivo con el precio unitario congelado en la reserva", () => {
    const airport = { ...base, zoneExtraCents: 20000, sportsLuggageCount: 1, sportsLuggageUnitCents: 15000 };
    expect(totalDerivadoCents(airport)).toBe(235000);
    expect(totalAlEditar({ basis: airport, totalCents: 235000, sportsLuggageCount: 3 }))
      .toEqual({ totalCents: 265000, deltaCents: 30000, seRecalcula: true });
  });

  it("no pisa una corrección manual del precio", () => {
    // 2 pasajeros a 100.000 son 200.000, pero el operador lo dejó en 180.000 a mano.
    expect(totalAlEditar({ basis: base, totalCents: 180000, passengerCount: 3 }))
      .toEqual({ totalCents: 180000, deltaCents: 0, seRecalcula: false });
    expect(totalAlEditar({ basis: base, totalCents: 180000, sportsLuggageCount: 2 }))
      .toEqual({ totalCents: 180000, deltaCents: 0, seRecalcula: false });
  });

  it("la cantidad mínima cubre a los menores que ya están dentro del total", () => {
    expect(minimoDePasajeros({ halfFareCount: 0, freeFareCount: 0 })).toBe(1);
    expect(minimoDePasajeros({ halfFareCount: 2, freeFareCount: 1 })).toBe(4);
  });
});
