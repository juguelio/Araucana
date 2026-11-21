import { describe, expect, it } from "vitest";
import { enlaceAlMapa, nombreDeUnidad } from "./enlace-mapa";

describe("enlaceAlMapa", () => {
  it("lleva la unidad al mapa en vivo con su id", () => {
    expect(enlaceAlMapa("clx123")).toBe("/admin/naves/en-vivo?unidad=clx123");
  });

  it("escapa el id: el enlace no se corta si trae caracteres raros", () => {
    expect(enlaceAlMapa("a b&c")).toBe("/admin/naves/en-vivo?unidad=a%20b%26c");
  });
});

describe("nombreDeUnidad", () => {
  it("prefiere el interno, que es como la operación nombra la unidad", () => {
    expect(nombreDeUnidad({ internalNumber: "24", name: "Renault Master" })).toBe("Interno 24");
  });

  it("si no hay interno, usa el nombre del vehículo", () => {
    expect(nombreDeUnidad({ internalNumber: null, name: "Renault Master" })).toBe("Renault Master");
  });
});
