import { describe, expect, it } from "vitest";
import { nombreDelLugarSugerido, pickupNameParaElChofer } from "./pickup-name";

/**
 * Los labels que siguen son los que devolvió el buscador real de producción el 20-nov-2026
 * (`POST /api/v1/airport/address`, `kind: "suggestions"`), no ejemplos inventados.
 */
describe("nombreDelLugarSugerido", () => {
  it("toma el nombre del lugar cuando la sugerencia es un punto de interés", () => {
    expect(
      nombreDelLugarSugerido({
        label:
          "Hotel el Viejo Esquiador, 1242, Avenida San Martín, Cantera, Centro, San Martín de los Andes, Departamento Lácar, Neuquén, 8370, Argentina",
        source: "locationiq",
        precision: "exact"
      })
    ).toBe("Hotel el Viejo Esquiador");
  });

  it("no propone nada cuando el label empieza con la altura", () => {
    expect(
      nombreDelLugarSugerido({
        label: "750, Juez del Valle, Tiro Federal, San Martín de los Andes, 8370, Argentina",
        source: "locationiq",
        precision: "exact"
      })
    ).toBe("");
  });

  it("no propone nada cuando el label es calle y altura", () => {
    expect(
      nombreDelLugarSugerido({
        label: "Coronel Rohde 975, San Martín de los Andes",
        source: "georef",
        precision: "interpolated"
      })
    ).toBe("");
    expect(
      nombreDelLugarSugerido({ label: "Coronel Rohde 975, San Martín de los Andes", source: "georef", precision: "exact" })
    ).toBe("");
  });

  it("no propone nada si la fuente no ubicó el punto con precisión exacta", () => {
    expect(
      nombreDelLugarSugerido({ label: "Hostal del Esquiador, Cnel. Rhode 975", source: "photon", precision: "street" })
    ).toBe("");
    expect(
      nombreDelLugarSugerido({ label: "Hostal del Esquiador, Cnel. Rhode 975", source: "photon", precision: "interpolated" })
    ).toBe("");
  });

  it("no propone nada cuando el primer segmento es una sola palabra (nombre de calle)", () => {
    expect(nombreDelLugarSugerido({ label: "Belgrano, San Martín de los Andes", source: "georef", precision: "exact" })).toBe("");
  });

  it("no propone un nombre que no entra en el campo del servidor (120)", () => {
    expect(
      nombreDelLugarSugerido({ label: `${"a".repeat(121)}, San Martín de los Andes`, source: "locationiq", precision: "exact" })
    ).toBe("");
  });

  it("no propone nada con un label vacío", () => {
    expect(nombreDelLugarSugerido({ label: "", source: "georef", precision: "exact" })).toBe("");
  });
});

/**
 * Los labels del catálogo son los que devolvió producción el 20-nov-2026 para fichas del padrón
 * municipal (`POST /api/v1/airport/address`, `kind: "suggestions"`).
 */
describe("nombreDelLugarSugerido — fichas del catálogo de alojamientos", () => {
  it("acepta un nombre de una sola palabra: en el padrón no puede ser una calle", () => {
    expect(
      nombreDelLugarSugerido({ label: "Turismo, Misionero Mascardi 517 · Centro · Hotel", source: "municipal", precision: "exact" })
    ).toBe("Turismo");
    expect(
      nombreDelLugarSugerido({ label: "Tunqueley, Perito Moreno 1120 · Centro · Hotel", source: "municipal", precision: "exact" })
    ).toBe("Tunqueley");
  });

  it("acepta el nombre aunque la ficha no tenga punto verificado (el pasajero marca el pin)", () => {
    expect(
      nombreDelLugarSugerido({ label: "Alhué, Los Andes 455 · Centro · Albergues - Hostel", source: "municipal", precision: "none" })
    ).toBe("Alhué");
  });

  it("acepta la ficha complementaria del registro provincial", () => {
    expect(
      nombreDelLugarSugerido({ label: "Hostal del Lago, Costanera 1234 · Centro · Hosterias", source: "municipal", precision: "exact" })
    ).toBe("Hostal del Lago");
  });

  it("sigue descartando el label que no entra en el campo del servidor", () => {
    expect(
      nombreDelLugarSugerido({ label: `${"a".repeat(121)}, Calle 1 · Centro · Hotel`, source: "municipal", precision: "exact" })
    ).toBe("");
  });
});

describe("pickupNameParaElChofer", () => {
  it("con el atajo de la sucursal manda el nombre de la oficina, no lo que quedó escrito", () => {
    expect(
      pickupNameParaElChofer({ usandoSucursal: true, sucursalLabel: "Oficina La Araucana", escrito: "Hostal del Esquiador" })
    ).toBe("Oficina La Araucana");
  });

  it("sin sucursal manda el nombre que escribió o eligió el pasajero", () => {
    expect(pickupNameParaElChofer({ usandoSucursal: false, sucursalLabel: null, escrito: "  Hostal del Esquiador  " })).toBe(
      "Hostal del Esquiador"
    );
  });

  it("vacío o sólo espacios no manda nada (el campo sigue opcional)", () => {
    expect(pickupNameParaElChofer({ usandoSucursal: false, escrito: "   " })).toBeUndefined();
    expect(pickupNameParaElChofer({ usandoSucursal: false })).toBeUndefined();
    expect(pickupNameParaElChofer({ usandoSucursal: true, sucursalLabel: "" })).toBeUndefined();
  });

  it("recorta a 120, que es el máximo del esquema del servidor", () => {
    const largo = "x".repeat(200);
    expect(pickupNameParaElChofer({ usandoSucursal: false, escrito: largo })).toHaveLength(120);
  });
});
