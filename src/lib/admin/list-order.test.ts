import { describe, expect, it } from "vitest";
import { alternarOrden, ariaSortDe, flechaDeOrden, hrefConOrden, leerOrden } from "./list-order";

const COLUMNAS = ["codigo", "pasajero", "creada"] as const;
const DEFECTO = { columna: "creada", direccion: "desc" } as const;

describe("orden de los listados del panel", () => {
  it("cae al orden por defecto cuando la URL no pide nada o pide una columna que no existe", () => {
    expect(leerOrden(COLUMNAS, DEFECTO, {})).toEqual({ columna: "creada", direccion: "desc" });
    expect(leerOrden(COLUMNAS, DEFECTO, { orden: "salaryCents" })).toEqual({ columna: "creada", direccion: "desc" });
    expect(leerOrden(COLUMNAS, DEFECTO, { orden: "", dir: "asc" })).toEqual({ columna: "creada", direccion: "desc" });
  });

  it("acepta una columna declarada y cae a ascendente si la dirección no se entiende", () => {
    expect(leerOrden(COLUMNAS, DEFECTO, { orden: "pasajero", dir: "desc" })).toEqual({ columna: "pasajero", direccion: "desc" });
    expect(leerOrden(COLUMNAS, DEFECTO, { orden: "pasajero", dir: "loQueSea" })).toEqual({ columna: "pasajero", direccion: "asc" });
    expect(leerOrden(COLUMNAS, DEFECTO, { orden: "pasajero" })).toEqual({ columna: "pasajero", direccion: "asc" });
  });

  it("el primer clic ordena ascendente y el segundo invierte; otra columna arranca de cero", () => {
    expect(alternarOrden({ columna: "creada", direccion: "desc" } as const, "codigo")).toEqual({ columna: "codigo", direccion: "asc" });
    expect(alternarOrden({ columna: "codigo", direccion: "asc" } as const, "codigo")).toEqual({ columna: "codigo", direccion: "desc" });
    expect(alternarOrden({ columna: "codigo", direccion: "desc" } as const, "codigo")).toEqual({ columna: "codigo", direccion: "asc" });
  });

  it("describe el orden activo para lectores de pantalla y dibuja la flecha sólo en esa columna", () => {
    const actual = { columna: "pasajero", direccion: "desc" } as const;
    expect(ariaSortDe(actual, "pasajero")).toBe("descending");
    expect(ariaSortDe(actual, "codigo")).toBe("none");
    expect(flechaDeOrden(actual, "pasajero")).toBe("↓");
    expect(flechaDeOrden({ columna: "codigo", direccion: "asc" } as const, "codigo")).toBe("↑");
    expect(flechaDeOrden(actual, "codigo")).toBeNull();
  });

  it("el link del encabezado conserva los filtros, fija el orden y vuelve a la página 1", () => {
    const href = hrefConOrden(
      "/admin/reservas",
      { code: "AB12", date: "2026-11-20", page: "3", notice: "Reserva creada" },
      { columna: "pasajero", direccion: "asc" }
    );
    const url = new URL(href, "https://panel.local");
    expect(url.pathname).toBe("/admin/reservas");
    expect(url.searchParams.get("code")).toBe("AB12");
    expect(url.searchParams.get("date")).toBe("2026-11-20");
    expect(url.searchParams.get("page")).toBeNull();
    expect(url.searchParams.get("notice")).toBeNull();
    expect(url.searchParams.get("orden")).toBe("pasajero");
    expect(url.searchParams.get("dir")).toBe("asc");
  });

  it("sin filtros el link queda sólo con el orden", () => {
    expect(hrefConOrden("/admin/reservas", {}, { columna: "codigo", direccion: "desc" })).toBe(
      "/admin/reservas?orden=codigo&dir=desc"
    );
  });
});
