import { describe, expect, it } from "vitest";
import { ariaSort, hrefDeOrden, hrefDePagina, leerOrdenDelListado, ordenarNaves, paginarNaves, type NaveDelListado } from "./fleet-table";

const hoy = new Date(2026, 10, 17);
const enDias = (dias: number) => new Date(2026, 10, 17 + dias);

function nave(over: Partial<NaveDelListado> & { id: string }): NaveDelListado {
  return {
    name: `Nave ${over.id}`,
    internalNumber: null,
    brand: "Mercedes",
    model: "Sprinter",
    licensePlate: null,
    year: null,
    owner: null,
    insurer: null,
    isActive: true,
    asientos: 19,
    technicalInspectionDueAt: null,
    rtoDueAt: null,
    policyDueAt: null,
    ...over
  };
}

const ids = (naves: NaveDelListado[]) => naves.map((n) => n.id);

describe("parámetros del listado de naves", () => {
  it("valores raros caen en el orden por defecto y la página 1", () => {
    expect(leerOrdenDelListado({ orden: "drop table", dir: "x", page: "-3" })).toEqual({ orden: null, dir: "asc", page: 1 });
    expect(leerOrdenDelListado({ orden: "titular", dir: "desc", page: "2" })).toEqual({ orden: "titular", dir: "desc", page: 2 });
  });

  it("el encabezado alterna el sentido y vuelve a la página 1", () => {
    expect(hrefDeOrden({ orden: null, dir: "asc", page: 3 }, "capacidad")).toBe("/admin/naves?orden=capacidad&dir=asc");
    expect(hrefDeOrden({ orden: "capacidad", dir: "asc", page: 3 }, "capacidad")).toBe("/admin/naves?orden=capacidad&dir=desc");
    expect(hrefDeOrden({ orden: "capacidad", dir: "desc", page: 1 }, "capacidad")).toBe("/admin/naves?orden=capacidad&dir=asc");
    expect(ariaSort({ orden: "capacidad", dir: "desc", page: 1 }, "capacidad")).toBe("descending");
    expect(ariaSort({ orden: "capacidad", dir: "desc", page: 1 }, "titular")).toBe("none");
  });

  it("la paginación conserva el orden elegido", () => {
    expect(hrefDePagina({ orden: "seguro", dir: "desc", page: 1 }, 2)).toBe("/admin/naves?orden=seguro&dir=desc&page=2");
    expect(hrefDePagina({ orden: null, dir: "asc", page: 2 }, 1)).toBe("/admin/naves");
  });
});

describe("orden del listado de naves", () => {
  it("por defecto: activas primero y después por interno, con orden numérico", () => {
    const naves = [nave({ id: "a", internalNumber: "243" }), nave({ id: "b", internalNumber: "1910", isActive: false }), nave({ id: "c", internalNumber: "152" })];
    expect(ids(ordenarNaves(naves, null, "asc", hoy))).toEqual(["c", "a", "b"]);
  });

  it("unidad: el interno se compara como número (152 < 243 < 1910)", () => {
    const naves = [nave({ id: "a", internalNumber: "1910" }), nave({ id: "b", internalNumber: "243" }), nave({ id: "c", internalNumber: "152" })];
    expect(ids(ordenarNaves(naves, "unidad", "asc", hoy))).toEqual(["c", "b", "a"]);
    expect(ids(ordenarNaves(naves, "unidad", "desc", hoy))).toEqual(["a", "b", "c"]);
  });

  it("año: la más vieja primero y las que no tienen año cargado al final, en los dos sentidos", () => {
    const naves = [nave({ id: "2019", year: 2019 }), nave({ id: "sin-anio" }), nave({ id: "2012", year: 2012 })];
    expect(ids(ordenarNaves(naves, "anio", "asc", hoy))).toEqual(["2012", "2019", "sin-anio"]);
    expect(ids(ordenarNaves(naves, "anio", "desc", hoy))).toEqual(["2019", "2012", "sin-anio"]);
  });

  it("vencimientos: lo vencido primero y las unidades sin fechas al final, en los dos sentidos", () => {
    const naves = [
      nave({ id: "al-dia", rtoDueAt: enDias(200) }),
      nave({ id: "sin-fechas" }),
      nave({ id: "vencida", policyDueAt: enDias(-5), rtoDueAt: enDias(300) }),
      nave({ id: "por-vencer", technicalInspectionDueAt: enDias(10) })
    ];
    expect(ids(ordenarNaves(naves, "vencimientos", "asc", hoy))).toEqual(["vencida", "por-vencer", "al-dia", "sin-fechas"]);
    expect(ids(ordenarNaves(naves, "vencimientos", "desc", hoy))).toEqual(["al-dia", "por-vencer", "vencida", "sin-fechas"]);
  });

  it("titular y seguro: sin dato va al final", () => {
    const naves = [nave({ id: "sin" }), nave({ id: "trompul", owner: "TROMPUL S.R.L." }), nave({ id: "araucana", owner: "LA ARAUCANA VIAJES SRL" })];
    expect(ids(ordenarNaves(naves, "titular", "asc", hoy))).toEqual(["araucana", "trompul", "sin"]);
    expect(ids(ordenarNaves(naves, "titular", "desc", hoy))).toEqual(["trompul", "araucana", "sin"]);
    const conSeguro = [nave({ id: "x" }), nave({ id: "prot", insurer: "Prot Mut" }), nave({ id: "fed", insurer: "Federación Patronal" })];
    expect(ids(ordenarNaves(conSeguro, "seguro", "asc", hoy))).toEqual(["fed", "prot", "x"]);
  });

  it("vehículo, capacidad y estado", () => {
    const naves = [
      nave({ id: "iveco", brand: "Iveco", model: "Daily", asientos: 15, isActive: false }),
      nave({ id: "mb", brand: "Mercedes", model: "O500", asientos: 45 }),
      nave({ id: "fiat", brand: "Fiat", model: "Ducato", asientos: 12 })
    ];
    expect(ids(ordenarNaves(naves, "vehiculo", "asc", hoy))).toEqual(["fiat", "iveco", "mb"]);
    expect(ids(ordenarNaves(naves, "capacidad", "desc", hoy))).toEqual(["mb", "iveco", "fiat"]);
    expect(ids(ordenarNaves(naves, "estado", "asc", hoy))[2]).toBe("iveco");
    expect(ids(ordenarNaves(naves, "estado", "desc", hoy))[0]).toBe("iveco");
  });
});

describe("paginación del listado de naves", () => {
  const naves = Array.from({ length: 45 }, (_, i) => i + 1);

  it("parte en páginas de 20", () => {
    expect(paginarNaves(naves, 1)).toMatchObject({ total: 45, page: 1, totalPages: 3, desde: 1, hasta: 20 });
    expect(paginarNaves(naves, 3)).toMatchObject({ items: [41, 42, 43, 44, 45], desde: 41, hasta: 45 });
  });

  it("una página fuera de rango muestra la última", () => {
    expect(paginarNaves(naves, 99)).toMatchObject({ page: 3, desde: 41 });
  });

  it("sin naves no rompe", () => {
    expect(paginarNaves([], 1)).toEqual({ items: [], total: 0, page: 1, totalPages: 1, desde: 0, hasta: 0 });
  });
});
