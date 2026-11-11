import { describe, expect, it } from "vitest";
import { fareCounts, fareSummary, halfFareCents, reservationTotalCents, seatsFromFares } from "./passenger-fares";

const RUTA = 1_800_000; // $18.000 en centavos

describe("tarifas por edad", () => {
  it("la media tarifa es la mitad exacta del precio", () => {
    expect(halfFareCents(RUTA)).toBe(900_000);
    expect(halfFareCents(3_500_000)).toBe(1_750_000);
  });

  it("redondea al centavo cuando el precio es impar", () => {
    expect(halfFareCents(1_800_001)).toBe(900_001);
    expect(halfFareCents(101)).toBe(51);
  });

  it("un solo adulto paga la tarifa entera", () => {
    expect(reservationTotalCents(RUTA, { full: 1, half: 0, free: 0 })).toBe(RUTA);
  });

  it("dos adultos y un menor de 4 a 8: entera + entera + media", () => {
    expect(reservationTotalCents(RUTA, { full: 2, half: 1, free: 0 })).toBe(RUTA * 2 + 900_000);
  });

  it("un menor de 4 sin cargo no suma importe pero sí ocupa lugar", () => {
    const counts = { full: 2, half: 0, free: 1 };
    expect(reservationTotalCents(RUTA, counts)).toBe(RUTA * 2);
    expect(seatsFromFares(counts)).toBe(3);
  });

  it("todos los lugares ocupados, con o sin pago", () => {
    expect(seatsFromFares({ full: 1, half: 2, free: 3 })).toBe(6);
    expect(seatsFromFares({ full: 0, half: 0, free: 0 })).toBe(0);
  });

  it("una reserva vieja sólo con passengerCount se lee como todos tarifa entera", () => {
    expect(fareCounts(3)).toEqual({ full: 3, half: 0, free: 0 });
    expect(reservationTotalCents(RUTA, fareCounts(3))).toBe(RUTA * 3);
  });

  it("los contadores de media y sin cargo se descuentan del total", () => {
    expect(fareCounts(4, 1, 1)).toEqual({ full: 2, half: 1, free: 1 });
  });

  it("no deja contadores negativos ni adultos por debajo de cero", () => {
    expect(fareCounts(1, 2)).toEqual({ full: 0, half: 2, free: 0 });
    expect(fareCounts(-3, -1, -1)).toEqual({ full: 0, half: 0, free: 0 });
  });

  it("resume el desglose para el comprobante", () => {
    expect(fareSummary({ full: 2, half: 1, free: 0 })).toBe("1 con media tarifa");
    expect(fareSummary({ full: 2, half: 1, free: 1 })).toBe("1 con media tarifa · 1 sin cargo");
    expect(fareSummary({ full: 2, half: 0, free: 0 })).toBe("");
  });
});
