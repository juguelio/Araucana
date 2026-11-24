import { describe, expect, it } from "vitest";
import { etiquetaDeConcesion, leerTipoDeConcesion, normalizarTipoDeConcesion } from "./kinds";

describe("tipos de concesión", () => {
  it("lee los tres servicios recurrentes", () => {
    expect(normalizarTipoDeConcesion("personal-aeropuerto")).toBe("personal-aeropuerto");
    expect(leerTipoDeConcesion("escuela")).toBe("escuela");
    expect(etiquetaDeConcesion("otro")).toBe("Otro recurrente");
  });

  it("conserva el tipo de los enlaces anteriores del panel", () => {
    expect(leerTipoDeConcesion("personal")).toBe("personal-aeropuerto");
    expect(normalizarTipoDeConcesion("PERSONAL")).toBe("personal-aeropuerto");
    expect(leerTipoDeConcesion("ESCOLAR")).toBe("escuela");
  });

  it("cae en escolar para datos viejos o valores raros", () => {
    expect(normalizarTipoDeConcesion(undefined)).toBe("escuela");
    expect(normalizarTipoDeConcesion("aeropuerto")).toBe("escuela");
    expect(leerTipoDeConcesion("todos")).toBeNull();
  });
});
