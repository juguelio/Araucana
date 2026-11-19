import { describe, expect, it } from "vitest";
import { hojaDeOrdenesHref, hojaDelChoferHref, MAX_VUELOS_POR_HOJA, ordenesDeLaHoja, vuelosDeLaHoja } from "./flight-selection";

describe("hoja del chofer de varios vuelos", () => {
  it("un vuelo abre su hoja; varios abren todas juntas, listas para imprimir", () => {
    expect(hojaDelChoferHref("2026-11-18", ["f1"])).toBe("/admin/aeropuerto/orden-de-servicio/ver?date=2026-11-18&flight=f1");
    expect(hojaDelChoferHref("2026-11-18", ["f1", "f2"])).toBe("/admin/aeropuerto/orden-de-servicio/ver?date=2026-11-18&flights=f1%2Cf2&imprimir=1");
  });

  it("de la URL toma sólo ids válidos, sin repetir y con tope", () => {
    expect(vuelosDeLaHoja("f1, f2,f1,../x,")).toEqual(["f1", "f2"]);
    expect(vuelosDeLaHoja(undefined)).toEqual([]);
    expect(vuelosDeLaHoja(Array.from({ length: 80 }, (_, i) => `f${i}`).join(","))).toHaveLength(MAX_VUELOS_POR_HOJA);
  });
});

describe("hoja del chofer por combi", () => {
  it("una orden abre la de su combi; varias se abren juntas para imprimir", () => {
    expect(hojaDeOrdenesHref("2026-11-19", [{ flight: "f1", vehicle: "asig-2" }])).toBe("/admin/aeropuerto/orden-de-servicio/ver?date=2026-11-19&flight=f1&vehicle=asig-2");
    expect(hojaDeOrdenesHref("2026-11-19", [{ flight: "f1", vehicle: null }])).toBe("/admin/aeropuerto/orden-de-servicio/ver?date=2026-11-19&flight=f1");
    expect(hojaDeOrdenesHref("2026-11-19", [{ flight: "f1", vehicle: "asig-2" }, { flight: "f3", vehicle: null }]))
      .toBe("/admin/aeropuerto/orden-de-servicio/ver?date=2026-11-19&ordenes=f1%7Easig-2%2Cf3%7E&imprimir=1");
  });

  it("de la URL toma sólo pares válidos y sin repetir", () => {
    expect(ordenesDeLaHoja("f1~asig-2,f3~, f1~asig-2,../x~y,f4")).toEqual([{ flight: "f1", vehicle: "asig-2" }, { flight: "f3", vehicle: null }]);
    expect(ordenesDeLaHoja(null)).toEqual([]);
  });
});
