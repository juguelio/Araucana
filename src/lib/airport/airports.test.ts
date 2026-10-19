import { describe, expect, it } from "vitest";
import { aeropuertoLabel, tramoDeVuelo } from "./airports";

describe("aeropuertoLabel", () => {
  it("nombra los aeropuertos conocidos, sin importar mayúsculas ni espacios", () => {
    expect(aeropuertoLabel("AEP")).toBe("Aeroparque (AEP)");
    expect(aeropuertoLabel(" eze ")).toBe("Ezeiza (EZE)");
  });

  it("si no lo conoce devuelve el código: mejor un código que un nombre inventado", () => {
    expect(aeropuertoLabel("XYZ")).toBe("XYZ");
  });

  it("traduce también la ciudad que publica el tablero del aeropuerto", () => {
    expect(aeropuertoLabel("AEROPARQUE")).toBe("Aeroparque (AEP)");
    expect(aeropuertoLabel("Ezeiza")).toBe("Ezeiza (EZE)");
    expect(aeropuertoLabel("CÓRDOBA")).toBe("Córdoba (COR)");
  });

  it("sin dato no devuelve nada", () => {
    expect(aeropuertoLabel(null)).toBeNull();
    expect(aeropuertoLabel(undefined)).toBeNull();
    expect(aeropuertoLabel("—")).toBeNull();
    expect(aeropuertoLabel("   ")).toBeNull();
  });
});

describe("tramoDeVuelo", () => {
  it("en una llegada dice desde dónde viene", () => {
    expect(tramoDeVuelo({ direction: "ARRIVAL", origin: "EZE" })).toBe("desde Ezeiza (EZE)");
  });

  it("en una salida desde Chapelco el otro extremo es el destino", () => {
    expect(tramoDeVuelo({ direction: "DEPARTURE", origin: "AEP" })).toBe("hacia Aeroparque (AEP)");
  });

  it("sin aeropuerto no inventa un tramo", () => {
    expect(tramoDeVuelo({ direction: "ARRIVAL", origin: null })).toBeNull();
    expect(tramoDeVuelo({ direction: "DEPARTURE", origin: "—" })).toBeNull();
  });
});
