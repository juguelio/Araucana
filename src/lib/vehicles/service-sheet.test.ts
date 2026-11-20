import { describe, expect, it } from "vitest";

import {
  ITEMS_DE_SERVICE,
  SECCIONES_DE_SERVICE,
  checksGuardados,
  leerPlanillaDeService,
  resumenDePlanilla
} from "./service-sheet";

/**
 * El catálogo es la planilla de papel del cliente: estos tests la cuidan. Si alguien agrega, saca o
 * renombra ítems, se entera acá y no cuando el taller abre la pantalla y no encuentra «Crucetas».
 */

describe("catálogo de la planilla de service", () => {
  it("replica los 50 ítems de la planilla en papel", () => {
    expect(ITEMS_DE_SERVICE).toHaveLength(50);
  });

  it("no repite ids: el id es la clave con la que se guarda cada tilde", () => {
    const ids = ITEMS_DE_SERVICE.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("mantiene los bloques que usa el taller", () => {
    expect(SECCIONES_DE_SERVICE.map((s) => s.label)).toEqual([
      "Motor",
      "Luces",
      "Vidrios",
      "Transmisión",
      "Arranque de motor",
      "Frenos",
      "Tren delantero",
      "Cubiertas",
      "Carrocería y chasis",
      "Cabina"
    ]);
  });

  it("conserva los ítems que Quique nombró en la reunión", () => {
    const labels = ITEMS_DE_SERVICE.map((i) => `${i.seccion}: ${i.label}`);
    expect(labels).toContain("Motor: Nivel de aceite");
    expect(labels).toContain("Transmisión: Crucetas");
    expect(labels).toContain("Cubiertas: Auxilio");
    expect(labels).toContain("Carrocería y chasis: Matafuego");
  });
});

describe("leerPlanillaDeService", () => {
  const base = { servicedAt: "2026-11-20", odometerKm: "148.320", workDone: "Aceite y filtros", notes: "", checks: {} };

  it("acepta la planilla con fecha, kilometraje y lo que se hizo", () => {
    const leido = leerPlanillaDeService({ ...base, checks: { "nivel-aceite": "OK", crucetas: "FALLA" } });
    expect(leido.ok).toBe(true);
    if (!leido.ok) return;
    expect(leido.data.odometerKm).toBe(148320);
    expect(leido.data.servicedAt.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(leido.data.checks).toEqual({ "nivel-aceite": "OK", crucetas: "FALLA" });
    expect(leido.data.workDone).toBe("Aceite y filtros");
    expect(leido.data.notes).toBeNull();
  });

  it("pide la fecha y el kilometraje: sin eso no sirve para el historial", () => {
    const leido = leerPlanillaDeService({ ...base, servicedAt: "", odometerKm: "" });
    expect(leido.ok).toBe(false);
    if (leido.ok) return;
    expect(leido.errores.servicedAt).toBeTruthy();
    expect(leido.errores.odometerKm).toBeTruthy();
  });

  it("rechaza un kilometraje que no es número", () => {
    const leido = leerPlanillaDeService({ ...base, odometerKm: "ciento cuarenta" });
    expect(leido.ok).toBe(false);
  });

  it("ignora ítems que no están en la planilla y estados inventados", () => {
    const leido = leerPlanillaDeService({ ...base, checks: { "item-que-no-existe": "OK", bujes: "MASO" } });
    expect(leido.ok).toBe(true);
    if (!leido.ok) return;
    expect(leido.data.checks).toEqual({});
  });
});

describe("resumenDePlanilla", () => {
  it("cuenta revisados, fallas y lo que quedó sin revisar", () => {
    expect(resumenDePlanilla({ "nivel-aceite": "OK", crucetas: "FALLA", bujes: "NA" })).toEqual({
      revisados: 3,
      fallas: 1,
      sinRevisar: 47
    });
  });

  it("una planilla vacía no inventa revisiones", () => {
    expect(resumenDePlanilla({})).toEqual({ revisados: 0, fallas: 0, sinRevisar: 50 });
  });
});

describe("checksGuardados", () => {
  it("lee lo que vuelve de la base y descarta lo que no es del catálogo", () => {
    expect(checksGuardados({ bujes: "OK", viejo: "OK", otro: 3 })).toEqual({ bujes: "OK" });
  });

  it("bancarse un JSON roto sin romper la ficha", () => {
    expect(checksGuardados(null)).toEqual({});
    expect(checksGuardados(["bujes"])).toEqual({});
    expect(checksGuardados("bujes")).toEqual({});
  });
});
