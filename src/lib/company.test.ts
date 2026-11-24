import { describe, expect, it } from "vitest";
import { COMPANY_CUIT, COMPANY_CUIT_LABEL } from "./company";

describe("datos fiscales de La Araucana", () => {
  it("publica el CUIT que pasó el cliente con formato argentino", () => {
    expect(COMPANY_CUIT).toBe("30-70959195-5");
    expect(COMPANY_CUIT).toMatch(/^\d{2}-\d{8}-\d$/);
    expect(COMPANY_CUIT_LABEL).toBe("CUIT 30-70959195-5");
  });

  it("el dígito verificador del CUIT es válido", () => {
    const digits = COMPANY_CUIT.replace(/\D/g, "");
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
    const remainder = 11 - (sum % 11);
    const expected = remainder === 11 ? 0 : remainder === 10 ? 9 : remainder;
    expect(Number(digits[10])).toBe(expected);
  });
});
