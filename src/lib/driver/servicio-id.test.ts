import { describe, expect, it } from "vitest";
import { parseServicioId, seAsignaDesdeNavesEnVivo } from "./servicio-id";

describe("parseServicioId: el prefijo dice contra qué tabla se asigna", () => {
  it("reconoce las cuatro áreas", () => {
    expect(parseServicioId("salida-abc123")).toEqual({ area: "RUTA", id: "abc123" });
    expect(parseServicioId("vuelo-fl_1")).toEqual({ area: "AEROPUERTO", id: "fl_1" });
    expect(parseServicioId("chapelco-dia1")).toEqual({ area: "CHAPELCO", id: "dia1" });
    expect(parseServicioId("especial-tr_9")).toEqual({ area: "ESPECIAL", id: "tr_9" });
  });

  it("acepta un id con guiones (los de Prisma los llevan)", () => {
    expect(parseServicioId("salida-cm4x1-ab2-9f")).toEqual({ area: "RUTA", id: "cm4x1-ab2-9f" });
  });

  it("no inventa área para un id desconocido o vacío", () => {
    expect(parseServicioId("cosa-1")).toBeNull();
    expect(parseServicioId("salida-")).toBeNull();
    expect(parseServicioId("")).toBeNull();
  });
});

describe("seAsignaDesdeNavesEnVivo", () => {
  it("ruta y aeropuerto sí; chapelco y especiales se asignan en su tablero", () => {
    expect(seAsignaDesdeNavesEnVivo("RUTA")).toBe(true);
    expect(seAsignaDesdeNavesEnVivo("AEROPUERTO")).toBe(true);
    expect(seAsignaDesdeNavesEnVivo("CHAPELCO")).toBe(false);
    expect(seAsignaDesdeNavesEnVivo("ESPECIAL")).toBe(false);
  });
});
