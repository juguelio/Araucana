import { describe, expect, it } from "vitest";
import { hojaDelChoferHref, MAX_VUELOS_POR_HOJA, vuelosDeLaHoja } from "./flight-selection";

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
