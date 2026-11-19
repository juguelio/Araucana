import { describe, expect, it } from "vitest";
import { errorDeMenores, minimoDePasajeros, tarifaPorPersona, totalAlEditar, totalDerivadoCents, type ReservationPriceBasis } from "./reservation-edit";

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

  it("recalcula con menores, bajada y recargo por zona nuevos", () => {
    // 2 adultos → 1 adulto + 1 media tarifa.
    expect(totalAlEditar({ basis: base, totalCents: 200000, halfFareCount: 1 }))
      .toEqual({ totalCents: 150000, deltaCents: -50000, seRecalcula: true });
    // Baja en una parada más barata.
    expect(totalAlEditar({ basis: base, totalCents: 200000, priceCents: 60000 }))
      .toEqual({ totalCents: 120000, deltaCents: -80000, seRecalcula: true });
    // El punto pasa a la zona con recargo.
    expect(totalAlEditar({ basis: base, totalCents: 200000, zoneExtraCents: 25000 }))
      .toEqual({ totalCents: 225000, deltaCents: 25000, seRecalcula: true });
  });
});

describe("bajada y menores al editar", () => {
  const ruta = { from: "San Martín", to: "Bariloche", priceCents: 100000, stops: [{ name: "Villa La Angostura", priceCents: 60000 }] };

  it("toma la tarifa de la parada donde baja, o la de la ruta", () => {
    expect(tarifaPorPersona(ruta, "Villa La Angostura")).toBe(60000);
    expect(tarifaPorPersona(ruta, null)).toBe(100000);
    expect(tarifaPorPersona(ruta, "Parada que ya no existe")).toBe(100000);
  });

  it("exige que los menores entren en el total y que quede un adulto", () => {
    expect(errorDeMenores({ passengerCount: 3, halfFareCount: 1, freeFareCount: 1 })).toBeNull();
    expect(errorDeMenores({ passengerCount: 2, halfFareCount: 2, freeFareCount: 1 })).toMatch(/no puede superar/);
    expect(errorDeMenores({ passengerCount: 2, halfFareCount: 1, freeFareCount: 1 })).toMatch(/tarifa entera/);
  });
});
