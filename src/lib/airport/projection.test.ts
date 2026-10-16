import { describe, expect, it } from "vitest";
import { DIAS_PROYECTADOS, fechaLocal, horaLocal, proyectarVuelos, type ObservableFlight } from "./projection";

const api = (o: Partial<ObservableFlight>): ObservableFlight => ({
  number: "AR1656",
  airline: "AR",
  origin: "AEP",
  destination: "Aeropuerto Chapelco (CPC)",
  direction: "ARRIVAL",
  scheduledAt: new Date("2026-10-16T18:45:00.000Z"), // 15:45 local
  source: "API",
  ...o
});

describe("proyectarVuelos", () => {
  it("repite el horario observado en la fecha pedida", () => {
    const [vuelo] = proyectarVuelos("2026-10-17", [api({})]);
    expect(fechaLocal(vuelo.scheduledAt)).toBe("2026-10-17");
    expect(horaLocal(vuelo.scheduledAt)).toBe("15:45");
    expect(vuelo.number).toBe("AR1656");
    expect(vuelo.source).toBe("ESTIMADO");
    expect(vuelo.status).toBe("SCHEDULED");
    expect(vuelo.estimatedAt).toBeNull();
  });

  it("sin datos reales no proyecta nada (no se inventan vuelos)", () => {
    expect(proyectarVuelos("2026-10-17", [api({ source: "ESTIMADO" })])).toEqual([]);
    expect(proyectarVuelos("2026-10-17", [])).toEqual([]);
  });

  it("prefiere el mismo día de la semana cuando lo conoce", () => {
    const miercoles = api({ number: "AR1656", scheduledAt: new Date("2026-10-14T18:45:00.000Z") });
    const sabado = api({ number: "AR9999", scheduledAt: new Date("2026-10-17T12:00:00.000Z") });
    // 2026-10-21 es miércoles: debe calcar el miércoles, no el sábado.
    const proyectados = proyectarVuelos("2026-10-21", [miercoles, sabado]);
    expect(proyectados.map((v) => v.number)).toEqual(["AR1656"]);
  });

  it("si no conoce ese día de la semana, usa el día real más reciente", () => {
    const viejo = api({ number: "AR1111", scheduledAt: new Date("2026-10-10T12:00:00.000Z") });
    const nuevo = api({ number: "AR2222", scheduledAt: new Date("2026-10-16T12:00:00.000Z") });
    const proyectados = proyectarVuelos("2026-10-30", [viejo, nuevo]);
    expect(proyectados.map((v) => v.number)).toEqual(["AR2222"]);
  });

  it("no duplica arribo y salida del mismo número a la misma hora", () => {
    const proyectados = proyectarVuelos("2026-10-17", [
      api({ number: "WJ3183", direction: "ARRIVAL" }),
      api({ number: "WJ3183", direction: "DEPARTURE" })
    ]);
    expect(proyectados).toHaveLength(2);
    expect(proyectados.map((v) => v.direction).sort()).toEqual(["ARRIVAL", "DEPARTURE"]);
  });

  it("proyecta un horizonte razonable de días", () => {
    expect(DIAS_PROYECTADOS).toBeGreaterThanOrEqual(14);
  });
});
