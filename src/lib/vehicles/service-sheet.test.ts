import { describe, expect, it } from "vitest";

import {
  ITEMS_DE_SERVICE,
  SECCIONES_DE_SERVICE,
  checksGuardados,
  checksParaGuardar,
  errorDeKilometraje,
  fallasQueSeRepiten,
  leerPlanillaDeService,
  notasGuardadas,
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

describe("notas de las fallas", () => {
  const base = { servicedAt: "2026-11-20", odometerKm: "150.100", workDone: "", notes: "" };
  it("guarda la nota sólo de los ítems con falla, recortada", () => {
    const leido = leerPlanillaDeService({
      ...base,
      checks: { "cubierta-delantera-derecha": "FALLA", bujes: "OK" },
      notas: { "cubierta-delantera-derecha": "  desgaste del lado de afuera ", bujes: "nada", crucetas: "sin estado", "no-existe": "x" }
    });
    expect(leido.ok && leido.data.notas).toEqual({ "cubierta-delantera-derecha": "desgaste del lado de afuera" });
    expect(leerPlanillaDeService({ ...base, checks: { bujes: "FALLA" }, notas: { bujes: "x".repeat(500) } })).toMatchObject({ ok: true, data: { notas: { bujes: "x".repeat(200) } } });
  });

  it("las guarda junto a los estados sin que los lectores viejos las vean", () => {
    const json = checksParaGuardar({ bujes: "FALLA" }, { bujes: "golpeado" });
    expect(json).toEqual({ bujes: "FALLA", _notas: { bujes: "golpeado" } });
    expect(checksParaGuardar({ bujes: "OK" }, {})).toEqual({ bujes: "OK" });
    expect(checksGuardados(json)).toEqual({ bujes: "FALLA" });
    expect(notasGuardadas(json)).toEqual({ bujes: "golpeado" });
    expect(notasGuardadas({ bujes: "OK" })).toEqual({});
    expect(notasGuardadas({ _notas: ["x"] })).toEqual({});
    expect(notasGuardadas({ _notas: { inventado: "x", bujes: 3 } })).toEqual({});
  });
});

describe("errorDeKilometraje", () => {
  const p = (fecha: string, km: number) => ({ servicedAt: new Date(`${fecha}T00:00:00Z`), odometerKm: km });
  const historial = [p("2026-08-12", 138_900), p("2026-10-28", 148_320)];
  it("acepta un número igual o mayor al último", () => {
    expect(errorDeKilometraje(p("2026-11-20", 150_100), historial)).toBeNull();
    expect(errorDeKilometraje(p("2026-11-20", 148_320), historial)).toBeNull();
    expect(errorDeKilometraje(p("2026-11-20", 1), [])).toBeNull();
  });
  it("frena el cuentakilómetros que va para atrás", () => {
    expect(errorDeKilometraje(p("2026-11-20", 14_832), historial)).toBe("Es menos que el service del 28/10/2026 (148.320 km). Revisá el número.");
  });
  it("una planilla vieja tiene que quedar entre las de antes y las de después", () => {
    expect(errorDeKilometraje(p("2026-09-15", 142_000), historial)).toBeNull();
    expect(errorDeKilometraje(p("2026-09-15", 160_000), historial)).toBe("Es más que el service posterior, del 28/10/2026 (148.320 km). Revisá el número o la fecha.");
  });
});

describe("fallasQueSeRepiten", () => {
  it("marca lo que falló en dos de las últimas tres planillas", () => {
    const planillas = [
      { checks: { "cubierta-delantera-derecha": "FALLA", bujes: "OK" } },
      { checks: { "cubierta-delantera-derecha": "FALLA", "pastillas-delanteras": "FALLA" } },
      { checks: { "pastillas-delanteras": "OK" } },
      { checks: { bujes: "FALLA" } }
    ];
    expect(fallasQueSeRepiten(planillas).map((i) => [i.id, i.veces, i.de])).toEqual([["cubierta-delantera-derecha", 2, 3]]);
    expect(fallasQueSeRepiten([])).toEqual([]);
  });
});
