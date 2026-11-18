import { describe, expect, it } from "vitest";
import { leerOrden } from "@/lib/admin/list-order";
import {
  COLUMNAS_SALIDAS,
  ORDEN_INICIAL_SALIDAS,
  ordenarSalidas,
  vistaDeSalidas,
  type SalidaOrdenable
} from "./lista";

const salidas: SalidaOrdenable[] = [
  { departureAt: new Date("2026-11-20T12:30:00Z"), vehicleName: "Combi 2", status: "OPEN", availableSeats: 9 },
  { departureAt: new Date("2026-11-18T09:00:00Z"), vehicleName: "Combi 1", status: "DOCUMENTATION", availableSeats: 0 },
  { departureAt: new Date("2026-11-19T18:15:00Z"), vehicleName: "Sprinter", status: "CLOSED", availableSeats: 4 }
];

describe("lista de salidas de una ruta (#192)", () => {
  it("la vista pedida en la URL cae al calendario cuando no es una de las declaradas", () => {
    expect(vistaDeSalidas("lista")).toBe("lista");
    expect(vistaDeSalidas("calendario")).toBe("calendario");
    expect(vistaDeSalidas("loQueSea")).toBe("calendario");
    expect(vistaDeSalidas(undefined)).toBe("calendario");
  });

  it("ordena por fecha en los dos sentidos, sin tocar las salidas originales", () => {
    const ascendente = ordenarSalidas(salidas, { columna: "fecha", direccion: "asc" });
    expect(ascendente.map((s) => s.vehicleName)).toEqual(["Combi 1", "Sprinter", "Combi 2"]);
    const descendente = ordenarSalidas(salidas, { columna: "fecha", direccion: "desc" });
    expect(descendente.map((s) => s.vehicleName)).toEqual(["Combi 2", "Sprinter", "Combi 1"]);
    expect(salidas.map((s) => s.vehicleName)).toEqual(["Combi 2", "Combi 1", "Sprinter"]);
  });

  it("ordena por cupo libre y por nave con el mismo criterio que el resto del panel", () => {
    expect(ordenarSalidas(salidas, { columna: "cupo", direccion: "asc" }).map((s) => s.availableSeats)).toEqual([0, 4, 9]);
    expect(ordenarSalidas(salidas, { columna: "cupo", direccion: "desc" }).map((s) => s.availableSeats)).toEqual([9, 4, 0]);
    expect(ordenarSalidas(salidas, { columna: "nave", direccion: "asc" }).map((s) => s.vehicleName)).toEqual(["Combi 1", "Combi 2", "Sprinter"]);
  });

  it("una columna que no está declarada cae al orden de la pantalla, no rompe", () => {
    const orden = leerOrden(COLUMNAS_SALIDAS, ORDEN_INICIAL_SALIDAS, { orden: "salaryCents", dir: "desc" });
    expect(orden).toEqual(ORDEN_INICIAL_SALIDAS);
    expect(ordenarSalidas(salidas, orden).map((s) => s.vehicleName)).toEqual(["Combi 1", "Sprinter", "Combi 2"]);
  });

  it("a igual valor el orden es estable: las salidas del mismo día no se mezclan entre páginas", () => {
    const mismoDia: SalidaOrdenable[] = [
      { departureAt: new Date("2026-11-18T09:00:00Z"), vehicleName: "Combi 1", status: "OPEN", availableSeats: 5 },
      { departureAt: new Date("2026-11-18T09:00:00Z"), vehicleName: "Combi 2", status: "OPEN", availableSeats: 5 }
    ];
    expect(ordenarSalidas(mismoDia, { columna: "cupo", direccion: "desc" }).map((s) => s.vehicleName)).toEqual(["Combi 1", "Combi 2"]);
  });
});
