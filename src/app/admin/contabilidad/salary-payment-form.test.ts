import { describe, expect, it } from "vitest";
import { centsToAmount } from "./salary-payment-form";

describe("centsToAmount", () => {
  it("manda el monto sugerido con coma decimal, como lo entiende el formulario", () => {
    expect(centsToAmount(79999_50)).toBe("79999,5");
    expect(centsToAmount(450_000_00)).toBe("450000");
    expect(centsToAmount(null)).toBe("");
  });
});
