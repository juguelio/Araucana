import { describe, expect, it } from "vitest";
import { asociarLectura, discrepancia, numeroCanonico, type FilaCandidata } from "./observation-match";

const fila = (over: Partial<FilaCandidata>): FilaCandidata => ({
  id: "f1",
  number: "AR1652",
  airline: "AR",
  origin: "AEP",
  direction: "ARRIVAL",
  scheduledAt: new Date("2026-11-14T14:45:00Z"), // 11:45 local
  ...over
});

describe("numeroCanonico", () => {
  it("unifica JetSMART y limpia espacios", () => {
    expect(numeroCanonico("wj 3182")).toBe("JA3182");
    expect(numeroCanonico("JA3182")).toBe("JA3182");
    expect(numeroCanonico(" ar1652 ")).toBe("AR1652");
  });
});

describe("asociarLectura", () => {
  it("encuentra el vuelo por número aunque el horario haya cambiado entre fuentes", () => {
    const r = asociarLectura(
      { direction: "ARRIVAL", rawNumber: "AR1652", airline: "AR", origin: "AEP", scheduledAt: new Date("2026-11-14T15:05:00Z") },
      [fila({})]
    );
    expect(r).toMatchObject({ flightId: "f1", nivel: "EXACTO", clave: "AR|AR1652|2026-11-14|ARRIVAL" });
  });

  it("WJ del proveedor y JA del tablero son el mismo vuelo", () => {
    const r = asociarLectura(
      { direction: "ARRIVAL", rawNumber: "WJ3182", airline: "WJ", scheduledAt: new Date("2026-11-14T15:37:00Z") },
      [fila({ id: "ja", number: "JA3182", airline: "JA" })]
    );
    expect(r).toMatchObject({ flightId: "ja", nivel: "EXACTO", canonicalNumber: "JA3182" });
  });

  it("un código compartido se asocia al vuelo que opera, no por cercanía", () => {
    const r = asociarLectura(
      { direction: "ARRIVAL", rawNumber: "LA7700", airline: "LA", codeshareOf: "AR1652", scheduledAt: new Date("2026-11-14T14:45:00Z") },
      [fila({})]
    );
    expect(r).toMatchObject({ flightId: "f1", nivel: "CODIGO_COMPARTIDO", canonicalNumber: "AR1652" });
  });

  it("dos filas del mismo vuelo ese día es un duplicado, no una elección", () => {
    const r = asociarLectura(
      { direction: "ARRIVAL", rawNumber: "JA3184", scheduledAt: new Date("2026-11-14T16:00:00Z") },
      [fila({ id: "a", number: "JA3184", airline: "JA" }), fila({ id: "b", number: "WJ3184", airline: "WJ" })]
    );
    expect(r).toMatchObject({ flightId: null, nivel: "AMBIGUO", ids: ["a", "b"] });
  });

  it("nunca asocia por cercanía con otra aerolínea (AJ325 no es AR1657)", () => {
    const r = asociarLectura(
      { direction: "ARRIVAL", rawNumber: "AR1657", airline: "AR", origin: "AEP", scheduledAt: new Date("2026-11-24T17:55:00Z") },
      [fila({ id: "aj", number: "AJ325", airline: "AJB", origin: "NQN", scheduledAt: new Date("2026-11-24T17:30:00Z") })]
    );
    expect(r).toMatchObject({ flightId: null, nivel: "SIN_VUELO" });
  });

  it("asocia por cercanía misma aerolínea y origen cuando cambió el número", () => {
    const r = asociarLectura(
      { direction: "ARRIVAL", rawNumber: "AR1650", airline: "AR", origin: "AEP", scheduledAt: new Date("2026-11-14T14:55:00Z") },
      [fila({})]
    );
    expect(r).toMatchObject({ flightId: "f1", nivel: "CERCANIA" });
  });

  it("no asocia por cercanía si el origen es otro aeropuerto", () => {
    const r = asociarLectura(
      { direction: "ARRIVAL", rawNumber: "AR1650", airline: "AR", origin: "COR", scheduledAt: new Date("2026-11-14T14:55:00Z") },
      [fila({})]
    );
    expect(r.nivel).toBe("SIN_VUELO");
  });

  it("origen en formatos distintos (IATA vs ciudad) no descarta", () => {
    const r = asociarLectura(
      { direction: "ARRIVAL", rawNumber: "AR1650", airline: "AR", origin: "Buenos Aires", scheduledAt: new Date("2026-11-14T14:55:00Z") },
      [fila({})]
    );
    expect(r.nivel).toBe("CERCANIA");
  });

  it("el día es el local: un vuelo de las 22 hora argentina no pasa al día siguiente", () => {
    const r = asociarLectura(
      { direction: "DEPARTURE", rawNumber: "AR1653", scheduledAt: new Date("2026-11-15T01:00:00Z") },
      [fila({ direction: "DEPARTURE", number: "AR1653", scheduledAt: new Date("2026-11-15T00:30:00Z") })]
    );
    expect(r).toMatchObject({ nivel: "EXACTO", clave: "AR|AR1653|2026-11-14|DEPARTURE" });
  });

  it("no compara contra el otro sentido", () => {
    const r = asociarLectura(
      { direction: "DEPARTURE", rawNumber: "AR1652", scheduledAt: new Date("2026-11-14T14:45:00Z") },
      [fila({})]
    );
    expect(r.nivel).toBe("SIN_VUELO");
  });

  it("sin horario ni día no se puede asociar", () => {
    const r = asociarLectura({ direction: "ARRIVAL", rawNumber: "AR1652", scheduledAt: null }, [fila({})]);
    expect(r.nivel).toBe("SIN_DATOS");
  });
});

describe("discrepancia", () => {
  const exacto = { flightId: "f1", nivel: "EXACTO" as const, clave: "k", canonicalNumber: "AR1652", ids: ["f1"] };
  const sinVuelo = { flightId: null, nivel: "SIN_VUELO" as const, clave: "k", canonicalNumber: "AR1657", ids: [] };

  it("coinciden: nada que avisar", () => {
    expect(discrepancia({ outcome: "ACTUALIZADO", flightId: "f1" }, exacto)).toBeNull();
  });

  it("el sync aplicó la lectura a otra fila", () => {
    expect(discrepancia({ outcome: "ACTUALIZADO", flightId: "f2" }, exacto)).toMatch(/corresponde a f1/);
  });

  it("un descarte por cercanía que dejó el vuelo fuera de la grilla es una pérdida", () => {
    expect(discrepancia({ outcome: "DESCARTADO_GEMELO", flightId: null }, sinVuelo)).toMatch(/AR1657 no quedó en la grilla/);
  });

  it("un código compartido descartado no es una pérdida", () => {
    expect(discrepancia({ outcome: "DESCARTADO_CODIGO_COMPARTIDO", flightId: null }, sinVuelo)).toBeNull();
  });

  it("un repetido siempre se informa", () => {
    expect(
      discrepancia({ outcome: "ACTUALIZADO", flightId: "a" }, { ...exacto, flightId: null, nivel: "AMBIGUO", ids: ["a", "b"] })
    ).toMatch(/2 filas/);
  });
});
