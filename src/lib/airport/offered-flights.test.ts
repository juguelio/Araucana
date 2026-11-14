import { describe, expect, it } from "vitest";
import {
  noSeOfrece,
  puedeTaparUnVueloDelTablero,
  VUELOS_QUE_NO_SE_OFRECEN,
} from "./offered-flights";

describe("vuelos que no se ofrecen", () => {
  it("cubre los American Jet de Neuquén", () => {
    expect([...VUELOS_QUE_NO_SE_OFRECEN].sort()).toEqual(["AJ324", "AJ325", "AJ328", "AJ329"]);
    for (const n of ["AJ324", "AJ325", "AJ328", "AJ329"]) expect(noSeOfrece(n)).toBe(true);
  });

  it("no excluye ningún vuelo de las aerolíneas que sí se venden", () => {
    for (const n of ["AR1652", "AR1656", "AR1657", "JA3181", "JA3182", "JA3184"]) {
      expect(noSeOfrece(n)).toBe(false);
    }
  });

  it("no depende de mayúsculas ni espacios", () => {
    expect(noSeOfrece(" aj329 ")).toBe(true);
    expect(noSeOfrece("Aj324")).toBe(true);
  });
});

describe("guard del tablero: una fila excluida no impide crear la de otro vuelo", () => {
  it("un AJ de Neuquén no puede tapar al vuelo que publica el aeropuerto (#145)", () => {
    // 24/11: fila AJ325 a las 14:30 y el tablero publica AR1657 a las 14:55 — 25 minutos exactos,
    // dentro de la ventana del guard. Antes, el AR1657 del tablero no se creaba nunca.
    for (const n of ["AJ324", "AJ325", "AJ328", "AJ329"]) {
      expect(puedeTaparUnVueloDelTablero(n)).toBe(false);
    }
    expect(puedeTaparUnVueloDelTablero(" aj325 ")).toBe(false);
  });

  it("un vuelo que sí se ofrece conserva la deduplicación por cercanía", () => {
    for (const n of ["AR1657", "JA3183", "WJ3183"]) {
      expect(puedeTaparUnVueloDelTablero(n)).toBe(true);
    }
  });
});
