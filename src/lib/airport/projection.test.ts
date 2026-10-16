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

  it("extiende los vuelos cargados a mano (aerolíneas que AirLabs no cubre)", () => {
    // American Jet vuela martes, jueves y sábados: se carga una vez y se repite en esos días.
    const martes = api({ number: "AJ324", airline: "AJ", source: "MANUAL", scheduledAt: new Date("2026-10-20T16:50:00.000Z") });
    const jueves = api({ number: "AJ324", airline: "AJ", source: "MANUAL", scheduledAt: new Date("2026-10-22T16:50:00.000Z") });
    const sabado = api({ number: "AJ324", airline: "AJ", source: "MANUAL", scheduledAt: new Date("2026-10-24T16:50:00.000Z") });

    const juevesSiguiente = proyectarVuelos("2026-10-29", [martes, jueves, sabado]);
    expect(juevesSiguiente.map((v) => v.number)).toEqual(["AJ324"]);
    expect(horaLocal(juevesSiguiente[0].scheduledAt)).toBe("13:50");
  });

  it("no inventa un vuelo en un día que no opera", () => {
    // Vuelo que sólo se vio martes, jueves y sábado: el miércoles no se proyecta.
    const m = api({ number: "AJ324", source: "MANUAL", scheduledAt: new Date("2026-10-20T16:50:00.000Z") });
    const j = api({ number: "AJ324", source: "MANUAL", scheduledAt: new Date("2026-10-22T16:50:00.000Z") });
    const s = api({ number: "AJ324", source: "MANUAL", scheduledAt: new Date("2026-10-24T16:50:00.000Z") });
    expect(proyectarVuelos("2026-10-21", [m, j, s])).toEqual([]); // miércoles
  });

  it("con una sola muestra asume servicio diario, pero no inventa si ya conoce varios días", () => {
    const unaMuestra = api({ number: "AR1656", source: "API", scheduledAt: new Date("2026-10-16T18:45:00.000Z") });
    expect(proyectarVuelos("2026-10-21", [unaMuestra])).toHaveLength(1);
  });

  it("para un mismo vuelo, usa el horario del mismo día de la semana si lo conoce", () => {
    // Mismo vuelo visto un miércoles 15:45 y un sábado 09:00: el miércoles proyectado usa 15:45.
    const miercoles = api({ number: "AR1656", scheduledAt: new Date("2026-10-14T18:45:00.000Z") });
    const sabado = api({ number: "AR1656", scheduledAt: new Date("2026-10-17T12:00:00.000Z") });
    const proyectados = proyectarVuelos("2026-10-21", [miercoles, sabado]);
    expect(proyectados).toHaveLength(1);
    expect(horaLocal(proyectados[0].scheduledAt)).toBe("15:45");
  });

  it("si no conoce ese día de la semana, para ese vuelo usa su ocurrencia más reciente", () => {
    const viejo = api({ number: "AR1111", scheduledAt: new Date("2026-10-10T12:00:00.000Z") });
    const nuevo = api({ number: "AR1111", scheduledAt: new Date("2026-10-16T15:30:00.000Z") });
    const proyectados = proyectarVuelos("2026-10-30", [viejo, nuevo]);
    expect(proyectados).toHaveLength(1);
    expect(horaLocal(proyectados[0].scheduledAt)).toBe("12:30");
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
