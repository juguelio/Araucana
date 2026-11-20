import { describe, expect, it } from "vitest";
import { lugarDeTerminal, terminalConocida, terminalParaElPasajero, textoDeTerminales } from "./terminals";

describe("terminales de las localidades (#276)", () => {
  it("reconoce la terminal con y sin tilde, y con la abreviatura que usa el panel", () => {
    expect(terminalConocida("San Martin de los Andes")).toBe("Terminal de Ómnibus de San Martín de los Andes");
    expect(terminalConocida("San Martín de los Andes")).toBe("Terminal de Ómnibus de San Martín de los Andes");
    expect(terminalConocida("S. M. Andes")).toBe("Terminal de Ómnibus de San Martín de los Andes");
    expect(terminalConocida("Villa Traful")).toBe("Terminal de Ómnibus de Villa Traful");
    expect(terminalConocida("villa la angostura")).toBe("Terminal de Ómnibus de Villa La Angostura");
  });

  it("no inventa terminal donde no la conoce", () => {
    expect(terminalConocida("Hua Hum")).toBeNull();
    expect(terminalConocida("Yuco")).toBeNull();
    expect(terminalConocida("Aeropuerto Chapelco (CPC)")).toBeNull();
    expect(terminalConocida("")).toBeNull();
    expect(terminalConocida(null)).toBeNull();
  });

  it("el voucher sigue imprimiendo el lugar tal cual cuando no hay terminal conocida", () => {
    expect(lugarDeTerminal("Hua Hum")).toBe("Hua Hum");
    expect(lugarDeTerminal(null)).toBe("");
    expect(lugarDeTerminal("Villa Traful")).toBe("Terminal de Ómnibus de Villa Traful");
  });

  it("en pantallas públicas la terminal se nombra con artículo", () => {
    expect(terminalParaElPasajero("Villa Traful")).toBe("la terminal de Villa Traful");
    expect(terminalParaElPasajero("Hua Hum")).toBeNull();
  });
});

describe("textoDeTerminales", () => {
  it("nombra las dos puntas cuando las dos son terminales", () => {
    expect(textoDeTerminales("San Martin de los Andes", "Villa Traful")).toBe(
      "Salida desde la terminal de San Martín de los Andes · Llegada a la terminal de Villa Traful"
    );
  });

  it("nombra sólo la punta que conoce", () => {
    expect(textoDeTerminales("San Martin de los Andes", "Hua Hum")).toBe("Salida desde la terminal de San Martín de los Andes");
    expect(textoDeTerminales("Hua Hum", "Villa Traful")).toBe("Llegada a la terminal de Villa Traful");
  });

  it("no escribe nada cuando ninguna punta es una terminal", () => {
    expect(textoDeTerminales("Hua Hum", "Yuco")).toBeNull();
    expect(textoDeTerminales(null, undefined)).toBeNull();
  });
});
