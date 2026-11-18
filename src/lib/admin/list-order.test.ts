import { describe, expect, it } from "vitest";
import { alternarOrden, ariaSortDe, flechaDeOrden, hrefConOrden, hrefDePagina, leerOrden, leerPagina, ordenarEnMemoria, paginar, rangoDePagina } from "./list-order";

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

describe("orden y paginación en memoria", () => {
  const filas = [
    { nombre: "beto", alta: new Date("2026-01-02"), sueldo: null as number | null },
    { nombre: "Ana", alta: new Date("2026-01-03"), sueldo: 300 },
    { nombre: "carla", alta: new Date("2026-01-01"), sueldo: 100 },
    { nombre: "", alta: new Date("2026-01-04"), sueldo: 200 }
  ];
  const valores = {
    nombre: (f: (typeof filas)[number]) => f.nombre,
    alta: (f: (typeof filas)[number]) => f.alta,
    sueldo: (f: (typeof filas)[number]) => f.sueldo
  };

  it("ordena texto sin distinguir mayúsculas, fechas y números, en los dos sentidos", () => {
    expect(ordenarEnMemoria(filas, { columna: "nombre", direccion: "asc" }, valores).map((f) => f.nombre)).toEqual(["Ana", "beto", "carla", ""]);
    expect(ordenarEnMemoria(filas, { columna: "alta", direccion: "desc" }, valores).map((f) => f.nombre)).toEqual(["", "Ana", "beto", "carla"]);
    expect(ordenarEnMemoria(filas, { columna: "sueldo", direccion: "asc" }, valores).map((f) => f.sueldo)).toEqual([100, 200, 300, null]);
  });

  it("deja los vacíos al final también en descendente", () => {
    expect(ordenarEnMemoria(filas, { columna: "sueldo", direccion: "desc" }, valores).map((f) => f.sueldo)).toEqual([300, 200, 100, null]);
    expect(ordenarEnMemoria(filas, { columna: "nombre", direccion: "desc" }, valores).at(-1)?.nombre).toBe("");
  });

  it("pagina y una página fuera de rango muestra la última", () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    expect(paginar(items, 2, 10)).toMatchObject({ items: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19], page: 2, totalPages: 3, desde: 11, hasta: 20 });
    expect(paginar(items, 99, 10)).toMatchObject({ page: 3, desde: 21, hasta: 23 });
    expect(paginar([], 1, 10)).toMatchObject({ total: 0, page: 1, totalPages: 1, desde: 0, hasta: 0 });
    expect(rangoDePagina(23, 3, 10)).toEqual({ total: 23, page: 3, totalPages: 3, desde: 21, hasta: 23, skip: 20 });
  });

  it("los links de página conservan filtros y orden, y los de orden vuelven a la página 1", () => {
    const params = { q: "ana", orden: "nombre", dir: "desc", page: "3", notice: "Guardado" };
    expect(hrefDePagina("/admin/usuarios", params, 2)).toBe("/admin/usuarios?q=ana&orden=nombre&dir=desc&page=2");
    expect(hrefDePagina("/admin/usuarios", params, 1)).toBe("/admin/usuarios?q=ana&orden=nombre&dir=desc");
    expect(hrefConOrden("/admin/viajes", { q: "x", pagina: "4" }, { columna: "pax", direccion: "asc" }, "pagina")).toBe("/admin/viajes?q=x&orden=pax&dir=asc");
    expect(leerPagina("abc")).toBe(1);
    expect(leerPagina("0")).toBe(1);
    expect(leerPagina("7")).toBe(7);
  });
});
