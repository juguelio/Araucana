import { describe, expect, it } from "vitest";
import { diasDeSemana, etiquetaDeSemana, leerSemana, lunesDe, sumarDias } from "./week";

describe("semana de concesiones", () => {
  it("arranca el lunes y devuelve siete días", () => {
    expect(lunesDe("2026-11-23")).toBe("2026-11-23");
    expect(lunesDe("2026-11-29")).toBe("2026-11-23");
    expect(diasDeSemana("2026-11-23")).toEqual([
      "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"
    ]);
  });

  it("navega y etiqueta el rango", () => {
    expect(sumarDias("2026-11-29", 1)).toBe("2026-11-30");
    expect(etiquetaDeSemana("2026-11-23")).toContain("23");
    expect(leerSemana("2026-11-23")).toBe("2026-11-23");
    expect(leerSemana("23/11/2026")).toBeNull();
  });
});
