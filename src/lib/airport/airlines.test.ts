import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AIRLINE_LOGO_CODES, airlineLogo, airlineName } from "./airlines";

describe("identidad de aerolínea", () => {
  it("traduce el código a un nombre legible", () => {
    expect(airlineName("AR")).toBe("Aerolíneas Argentinas");
    expect(airlineName("wj")).toBe("JetSMART");
    expect(airlineName("AJ")).toBe("American Jet");
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

  it("encuentra el logo de American Jet venga como IATA (AJ) o ICAO (AJB)", () => {
    expect(airlineLogo("AJ")).toBe("/airlines/AJ.png");
    expect(airlineLogo("ajb")).toBe("/airlines/AJ.png");
  });

  it("no promete un logo que no está en public/airlines (imagen rota en el badge)", () => {
    const dir = path.join(process.cwd(), "public/airlines");
    const faltantes = [...AIRLINE_LOGO_CODES].filter((code) => !existsSync(path.join(dir, `${code}.png`)));
    expect(faltantes).toEqual([]);
  });
});
