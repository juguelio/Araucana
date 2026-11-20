import { describe, expect, it } from "vitest";
import { phoneCountries, phoneCountryLabel } from "./phone-countries";

describe("phoneCountries", () => {
  it("tiene todos los países, no solo los de la región (un celular +44 no se podía cargar)", () => {
    const codes = phoneCountries.map((c) => c.value);
    for (const code of ["+44", "+49", "+33", "+39", "+7", "+81", "+86", "+61", "+52", "+57", "+972"]) {
      expect(codes).toContain(code);
    }
    expect(phoneCountries.length).toBeGreaterThan(200);
  });

  it("una opción por código, porque el código es el valor del <select>", () => {
    const codes = phoneCountries.map((c) => c.value);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("arranca con Argentina y los vecinos, y muestra bandera y código", () => {
    expect(phoneCountries.slice(0, 3).map((c) => c.value)).toEqual(["+54", "+56", "+55"]);
    const uk = phoneCountries.find((c) => c.value === "+44")!;
    expect(phoneCountryLabel(uk)).toBe("🇬🇧 Reino Unido +44");
  });
});
