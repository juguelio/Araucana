import { describe, expect, it } from "vitest";
import { airlineLogo, airlineName } from "./airlines";

describe("identidad de aerolínea", () => {
  it("traduce el código a un nombre legible", () => {
    expect(airlineName("AR")).toBe("Aerolíneas Argentinas");
    expect(airlineName("wj")).toBe("JetSMART");
  });

  it("si no la conocemos, devuelve el código (no inventa un nombre)", () => {
    expect(airlineName("ZZ")).toBe("ZZ");
    expect(airlineName(null)).toBeNull();
    expect(airlineName("  ")).toBeNull();
  });

  it("devuelve logo sólo de las aerolíneas que tenemos cargadas", () => {
    expect(airlineLogo("ar")).toBe("/airlines/AR.png");
    expect(airlineLogo("ZZ")).toBeNull();
  });
});
