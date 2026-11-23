import { describe, expect, it } from "vitest";
import { cadenciaTecnica, edadDeNave, filtrarNaves, leerFiltroFlota, papelesDeNave, resumenFlota, type NaveDeFlota } from "./fleet-board";

const hoy = new Date(2026, 10, 23);

const nave = (overrides: Partial<NaveDeFlota> = {}): NaveDeFlota => ({
  id: "n1",
  name: "Araucana 24",
  internalNumber: "24",
  brand: "Mercedes",
  model: "Sprinter",
  licensePlate: "AB123CD",
  year: 2014,
  acquiredAt: null,
  owner: "La Araucana",
  insurer: "Prot Mut",
  isActive: true,
  asientos: 19,
  publicTransport: true,
  kind: "BUS",
  notes: null,
  technicalInspectionDueAt: null,
  rtoDueAt: null,
  policyDueAt: null,
  ...overrides
});

describe("tablero general de flota", () => {
  it("calcula antigüedad desde la adquisición y marca la estimada por año modelo", () => {
    expect(edadDeNave(nave({ acquiredAt: new Date(2016, 5, 10) }), hoy)).toEqual({ anios: 10, estimada: false });
    expect(edadDeNave(nave({ acquiredAt: new Date(2016, 11, 1) }), hoy)).toEqual({ anios: 9, estimada: false });
    expect(edadDeNave(nave({ year: 2014 }), hoy)).toEqual({ anios: 12, estimada: true });
  });

  it("define la cadencia de técnica/RTO por edad", () => {
    expect(cadenciaTecnica(9)).toBe("6 meses");
    expect(cadenciaTecnica(10)).toBe("3 meses");
    expect(cadenciaTecnica(14)).toBe("3 meses");
    expect(cadenciaTecnica(15)).toBe("sin habilitación");
  });

  it("avisa 30 días y distingue vencido de próximo", () => {
    const papeles = papelesDeNave(nave({ rtoDueAt: new Date(2026, 11, 5), technicalInspectionDueAt: new Date(2026, 10, 1) }), hoy);
    expect(papeles.find((p) => p.tipo === "RTO")).toMatchObject({ nivel: "proximo", dias: 12 });
    expect(papeles.find((p) => p.tipo === "Técnica")).toMatchObject({ nivel: "vencido", dias: -22 });
  });

  it("filtra por tipo, uso, edad y papeles", () => {
    const naves = [
      nave({ id: "bus", kind: "BUS", publicTransport: true, rtoDueAt: new Date(2026, 11, 5) }),
      nave({ id: "camioneta", kind: "CAMIONETA", publicTransport: false, year: 2008 }),
      nave({ id: "utilitario", kind: "UTILITARIO", publicTransport: false, isActive: false })
    ];
    expect(filtrarNaves(naves, leerFiltroFlota({ tipo: "BUS" }), hoy).map((n) => n.id)).toEqual(["bus"]);
    expect(filtrarNaves(naves, leerFiltroFlota({ uso: "no-habilitada" }), hoy).map((n) => n.id)).toEqual(["utilitario"]);
    expect(filtrarNaves(naves, leerFiltroFlota({ edad: "15+" }), hoy).map((n) => n.id)).toEqual(["camioneta"]);
    expect(filtrarNaves(naves, leerFiltroFlota({ papel: "proximo" }), hoy).map((n) => n.id)).toEqual(["bus"]);
  });

  it("resume la flota para los indicadores", () => {
    const resumen = resumenFlota([
      nave({ id: "a", publicTransport: true, rtoDueAt: new Date(2026, 10, 20) }),
      nave({ id: "b", year: 2011, publicTransport: false, policyDueAt: new Date(2026, 11, 10) }),
      nave({ id: "c", year: 2012, publicTransport: false })
    ], hoy);
    expect(resumen).toMatchObject({ total: 3, publico: 1, vencidos: 1, porVencer: 1, proximasA15: 2 });
  });
});
