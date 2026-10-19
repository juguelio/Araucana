import { describe, expect, it } from "vitest";
import { decidirRefresco, diaEnArgentina, parseState } from "./freshness";

const topes = { minutos: 30, maxPorDia: 12 };

describe("día en curso en Argentina", () => {
  it("usa UTC-3 aunque en UTC ya sea otro día", () => {
    expect(diaEnArgentina(new Date("2026-10-20T02:00:00Z"))).toBe("2026-10-19");
    expect(diaEnArgentina(new Date("2026-10-20T03:00:00Z"))).toBe("2026-10-20");
  });
});

describe("decisión de refresco", () => {
  const ahora = new Date("2026-10-19T15:00:00Z"); // 12:00 en Argentina
  const dia = "2026-10-19";

  it("pide datos cuando nunca corrió", () => {
    expect(decidirRefresco({ at: null, dia: null, corridas: 0 }, dia, ahora, topes)).toEqual({
      refrescar: true,
      motivo: "sin corrida previa"
    });
  });

  it("no vuelve a pedir si el dato es reciente", () => {
    const estado = { at: "2026-10-19T14:45:00Z", dia, corridas: 1 };
    expect(decidirRefresco(estado, dia, ahora, topes)).toEqual({ refrescar: false, motivo: "dato reciente" });
  });

  it("vuelve a pedir cuando el dato pasó el mínimo", () => {
    const estado = { at: "2026-10-19T14:00:00Z", dia, corridas: 1 };
    expect(decidirRefresco(estado, dia, ahora, topes)).toMatchObject({ refrescar: true, motivo: "dato viejo" });
  });

  it("corta al llegar al tope diario: la cuota del plan free es limitada", () => {
    const estado = { at: "2026-10-19T10:00:00Z", dia, corridas: 12 };
    expect(decidirRefresco(estado, dia, ahora, topes)).toEqual({
      refrescar: false,
      motivo: "presupuesto diario agotado"
    });
  });

  it("el tope diario se reinicia al cambiar el día", () => {
    const estado = { at: "2026-10-18T10:00:00Z", dia: "2026-10-18", corridas: 12 };
    expect(decidirRefresco(estado, dia, ahora, topes).refrescar).toBe(true);
  });

  it("no gasta cuota por días futuros: la API sólo publica hoy", () => {
    expect(decidirRefresco({ at: null, dia: null, corridas: 0 }, "2026-10-25", ahora, topes)).toEqual({
      refrescar: false,
      motivo: "no es el día en curso"
    });
  });
});

describe("estado de la última sincronización", () => {
  it("tolera que el valor guardado no sea válido", () => {
    expect(parseState(null)).toEqual({ at: null, dia: null, corridas: 0 });
    expect(parseState("no-json")).toEqual({ at: null, dia: null, corridas: 0 });
    expect(parseState('{"corridas":"tres"}')).toEqual({ at: null, dia: null, corridas: 0 });
  });

  it("lee el estado guardado", () => {
    expect(parseState('{"at":"2026-10-19T15:00:00Z","dia":"2026-10-19","corridas":3}')).toEqual({
      at: "2026-10-19T15:00:00Z",
      dia: "2026-10-19",
      corridas: 3
    });
  });
});
