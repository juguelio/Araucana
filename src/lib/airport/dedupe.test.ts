import { describe, expect, it } from "vitest";
import { elegirAutoritativa, elegirSuperviviente, planificarUnificacionJetSmart, type FilaDeVuelo } from "./dedupe";
import { jetSmartCanonicalNumber } from "./flights";

const fila = (p: Partial<FilaDeVuelo> & Pick<FilaDeVuelo, "id" | "number">): FilaDeVuelo => ({
  direction: "DEPARTURE",
  dia: "2026-11-12",
  source: "API",
  updatedAt: new Date("2026-11-12T12:00:00Z"),
  reservas: 0,
  combis: 0,
  ...p
});

describe("jetSmartCanonicalNumber", () => {
  it("unifica cualquier vuelo de JetSMART, no sólo 3182 y 3183", () => {
    expect(jetSmartCanonicalNumber("WJ3184")).toBe("JA3184");
    expect(jetSmartCanonicalNumber("wj 3181")).toBe("JA3181");
    expect(jetSmartCanonicalNumber("JA3183")).toBe("JA3183");
  });
  it("no toca vuelos de otras aerolíneas", () => {
    expect(jetSmartCanonicalNumber("AR1656")).toBeNull();
    expect(jetSmartCanonicalNumber("AJ328")).toBeNull();
    expect(jetSmartCanonicalNumber("LV-BET")).toBeNull();
  });
});

describe("planificarUnificacionJetSmart", () => {
  it("conserva la fila con reservas aunque la otra tenga mejor fuente (la reserva no se mueve)", () => {
    const filas = [
      fila({ id: "ja", number: "JA3184", source: "FIDS" }),
      fila({ id: "wj", number: "WJ3184", source: "ESTIMADO", reservas: 2 })
    ];
    expect(elegirSuperviviente(filas)?.id).toBe("wj");
    // Pero los datos operativos los aporta el tablero: se copian antes de borrar esa fila.
    expect(elegirAutoritativa(filas)?.id).toBe("ja");
  });

  it("sin reservas ni combis manda la fuente y después la más reciente", () => {
    const filas = [
      fila({ id: "vieja", number: "JA3181", source: "API", updatedAt: new Date("2026-11-01T00:00:00Z") }),
      fila({ id: "nueva", number: "WJ3181", source: "API", updatedAt: new Date("2026-11-12T00:00:00Z") }),
      fila({ id: "tablero", number: "JA3181", source: "FIDS", updatedAt: new Date("2026-10-01T00:00:00Z") })
    ];
    expect(elegirSuperviviente(filas)?.id).toBe("tablero");
    expect(elegirAutoritativa(filas)?.id).toBe("tablero");
  });

  it("una combi asignada también protege la fila", () => {
    const filas = [
      fila({ id: "con-combi", number: "WJ3184", source: "ESTIMADO", combis: 1 }),
      fila({ id: "tablero", number: "JA3184", source: "FIDS" })
    ];
    expect(elegirSuperviviente(filas)?.id).toBe("con-combi");
    expect(elegirAutoritativa(filas)?.id).toBe("tablero");
  });

  it("caso del 12-nov: JA3184 del tablero y WJ3184 de la API → queda JA3184 (con sus 3 reservas)", () => {
    const plan = planificarUnificacionJetSmart([
      fila({ id: "ja", number: "JA3184", source: "FIDS", reservas: 3 }),
      fila({ id: "wj", number: "WJ3184", source: "API" })
    ]);
    expect(plan).toEqual({ borrar: ["wj"], renombrar: [], conReservasRepetidas: [] });
  });

  it("sin reservas manda la fuente: el tablero le gana a la API aunque la API sea la WJ", () => {
    const plan = planificarUnificacionJetSmart([
      fila({ id: "wj", number: "WJ3184", source: "API" }),
      fila({ id: "ja", number: "JA3184", source: "FIDS" })
    ]);
    expect(plan.borrar).toEqual(["wj"]);
    expect(plan.renombrar).toEqual([]);
  });

  it("si la que queda es WJ (por ejemplo, la única con reservas) se pasa a JA", () => {
    const plan = planificarUnificacionJetSmart([
      fila({ id: "ja", number: "JA3181", source: "ESTIMADO" }),
      fila({ id: "wj", number: "WJ3181", source: "ESTIMADO", reservas: 2 })
    ]);
    expect(plan).toEqual({ borrar: ["ja"], renombrar: [{ id: "wj", number: "JA3181" }], conReservasRepetidas: [] });
  });

  it("un WJ solo en su día también se pasa a JA (WJ3181 real de hoy)", () => {
    const plan = planificarUnificacionJetSmart([fila({ id: "wj", number: "WJ3181", direction: "ARRIVAL" })]);
    expect(plan).toEqual({ borrar: [], renombrar: [{ id: "wj", number: "JA3181" }], conReservasRepetidas: [] });
  });

  it("entre dos proyecciones sin reservas queda la más reciente", () => {
    const plan = planificarUnificacionJetSmart([
      fila({ id: "vieja", number: "JA3181", source: "ESTIMADO", updatedAt: new Date("2026-11-01T00:00:00Z") }),
      fila({ id: "nueva", number: "WJ3181", source: "ESTIMADO", updatedAt: new Date("2026-11-12T00:00:00Z") })
    ]);
    expect(plan.borrar).toEqual(["vieja"]);
    expect(plan.renombrar).toEqual([{ id: "nueva", number: "JA3181" }]);
  });

  it("nunca borra una fila con reservas: si las dos tienen, quedan las dos y se informa", () => {
    const plan = planificarUnificacionJetSmart([
      fila({ id: "ja", number: "JA3184", source: "FIDS", reservas: 1 }),
      fila({ id: "wj", number: "WJ3184", source: "API", reservas: 2 })
    ]);
    expect(plan.borrar).toEqual([]);
    expect(plan.renombrar).toEqual([]);
    expect(plan.conReservasRepetidas).toEqual([{ number: "JA3184", direction: "DEPARTURE", dia: "2026-11-12", ids: ["ja", "wj"] }]);
  });

  it("no mezcla días, sentidos ni otras aerolíneas", () => {
    const plan = planificarUnificacionJetSmart([
      fila({ id: "hoy", number: "JA3184" }),
      fila({ id: "manana", number: "JA3184", dia: "2026-11-13" }),
      fila({ id: "llegada", number: "JA3184", direction: "ARRIVAL" }),
      fila({ id: "ar1", number: "AR1656" }),
      fila({ id: "ar2", number: "AR1656" })
    ]);
    expect(plan).toEqual({ borrar: [], renombrar: [], conReservasRepetidas: [] });
  });
});
