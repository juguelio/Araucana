import { describe, expect, it } from "vitest";
import { noSeOfrece, VUELOS_QUE_NO_SE_OFRECEN } from "./offered-flights";

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
