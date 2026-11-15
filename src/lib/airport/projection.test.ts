import { describe, expect, it } from "vitest";
import { noSeOfrece } from "./offered-flights";
import { debeRealinear, esGemeloHorario, DIAS_PROYECTADOS, fechaLocal, horaLocal, mismaFrecuenciaSemanal, proyectarVuelos, type ObservableFlight } from "./projection";

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
    // El vuelo manual vuela martes, jueves y sábados: se carga una vez y se repite en esos días.
    const martes = api({ number: "AJ900", airline: "AJ", source: "MANUAL", scheduledAt: new Date("2026-10-20T16:50:00.000Z") });
    const jueves = api({ number: "AJ900", airline: "AJ", source: "MANUAL", scheduledAt: new Date("2026-10-22T16:50:00.000Z") });
    const sabado = api({ number: "AJ900", airline: "AJ", source: "MANUAL", scheduledAt: new Date("2026-10-24T16:50:00.000Z") });

    const juevesSiguiente = proyectarVuelos("2026-10-29", [martes, jueves, sabado]);
    expect(juevesSiguiente.map((v) => v.number)).toEqual(["AJ900"]);
    expect(horaLocal(juevesSiguiente[0].scheduledAt)).toBe("13:50");
  });

  it("no inventa un vuelo en un día que no opera", () => {
    // Vuelo que sólo se vio martes, jueves y sábado: el miércoles no se proyecta.
    const m = api({ number: "AJ324", source: "MANUAL", scheduledAt: new Date("2026-10-20T16:50:00.000Z") });
    const j = api({ number: "AJ324", source: "MANUAL", scheduledAt: new Date("2026-10-22T16:50:00.000Z") });
    const s = api({ number: "AJ324", source: "MANUAL", scheduledAt: new Date("2026-10-24T16:50:00.000Z") });
    expect(proyectarVuelos("2026-10-21", [m, j, s])).toEqual([]); // miércoles
  });

  it("sólo proyecta los días de la semana que se vieron: tres días seguidos no son «diario»", () => {
    // AR1654/AR1655 opera miércoles, jueves y viernes. Tres días consecutivos parecían un servicio
    // diario y el vuelo se proyectaba los martes sin su par: el tablero mostraba 5 arribos y 6
    // partidas el 17/11. Los dos son el mismo avión, el que llega es el que después sale.
    const miercoles = api({ number: "AR1655", direction: "DEPARTURE", scheduledAt: new Date("2026-11-11T16:45:00.000Z") });
    const jueves = api({ number: "AR1655", direction: "DEPARTURE", scheduledAt: new Date("2026-11-12T16:00:00.000Z") });
    const viernes = api({ number: "AR1655", direction: "DEPARTURE", scheduledAt: new Date("2026-11-13T16:00:00.000Z") });

    expect(proyectarVuelos("2026-11-17", [miercoles, jueves, viernes])).toHaveLength(0); // martes
    expect(proyectarVuelos("2026-11-21", [miercoles, jueves, viernes])).toHaveLength(0); // sábado
    expect(proyectarVuelos("2026-11-18", [miercoles, jueves, viernes])).toHaveLength(1); // miércoles
    expect(proyectarVuelos("2026-11-19", [miercoles, jueves, viernes])).toHaveLength(1); // jueves
  });

  it("un vuelo visto todos los días de la semana sí se proyecta cualquier día", () => {
    // JetSMART (JA3182) opera a diario: ahí la proyección tiene que cubrir los siete días.
    const dias = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
    const muestras = dias.map((d) => api({ number: "JA3182", direction: "DEPARTURE", scheduledAt: new Date(`${d}T16:50:00.000Z`) }));
    expect(proyectarVuelos("2026-11-20", muestras)).toHaveLength(1); // viernes
    expect(proyectarVuelos("2026-11-24", muestras)).toHaveLength(1); // martes
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

describe("mismaFrecuenciaSemanal", () => {
  it("sólo alinea los días futuros del mismo día de la semana que el tablero", () => {
    expect(mismaFrecuenciaSemanal("2026-11-21", "2026-11-14")).toBe(true); // sábado → sábado
    // El domingo 15-nov sale 13:50 en JetSMART y el sábado 14 salió 12:37: no es el mismo horario.
    expect(mismaFrecuenciaSemanal("2026-11-15", "2026-11-14")).toBe(false);
  });
});

describe("debeRealinear (issue #145)", () => {
  const objetivo = new Date("2026-11-15T16:50:00.000Z"); // 13:50 en San Martín
  const fila = (p = {}) => ({
    source: "ESTIMADO",
    scheduledAt: new Date("2026-11-15T18:37:00.000Z"), // 15:37, la hora del vuelo del sábado
    reservas: 0,
    assignments: 0,
    ...p
  });

  it("corrige una proyección suelta que quedó con la hora de otro día", () => {
    expect(debeRealinear(fila(), objetivo)).toBe(true);
  });

  it("no toca una fila con reservas ni con combi asignada", () => {
    expect(debeRealinear(fila({ reservas: 1 }), objetivo)).toBe(false);
    expect(debeRealinear(fila({ assignments: 1 }), objetivo)).toBe(false);
  });

  it("no toca datos reales de la API, del tablero ni una carga manual", () => {
    for (const source of ["API", "FIDS", "MANUAL"]) {
      expect(debeRealinear(fila({ source }), objetivo)).toBe(false);
    }
  });

  it("no reescribe si ya está en la hora del patrón", () => {
    expect(debeRealinear(fila({ scheduledAt: objetivo }), objetivo)).toBe(false);
  });
});

describe("vuelos que no se ofrecen (pedido del cliente, 14-nov)", () => {
  it("no proyecta los American Jet de Neuquén", () => {
    const aj = api({ number: "AJ324", source: "MANUAL", scheduledAt: new Date("2026-10-22T16:50:00.000Z") });
    const proyectados = proyectarVuelos("2026-11-17", [aj, api({})]);
    expect(proyectados.map((p) => p.number)).not.toContain("AJ324");
    expect(proyectados.map((p) => p.number)).toContain("AR1656");
    expect(noSeOfrece("AJ328")).toBe(true);
    expect(noSeOfrece("aj329")).toBe(true);
    expect(noSeOfrece("AR1656")).toBe(false);
  });
});

describe("esGemeloHorario (el AJ de Neuquén no tapa al AR de Aeroparque)", () => {
  const proyectado = { direction: "DEPARTURE", airline: "Aerolíneas Argentinas" };
  const cuando = new Date("2026-11-24T17:55:00.000Z"); // 14:55 local

  it("no considera gemelo a un vuelo de otra aerolínea, aunque esté a 25 minutos", () => {
    // El caso real: AJ325 de American Jet a las 14:30 bloqueaba el AR1657 de las 14:55.
    const aj = { direction: "DEPARTURE", airline: "American Jet", number: "AJ325", scheduledAt: new Date("2026-11-24T17:30:00.000Z") };
    expect(esGemeloHorario(proyectado, aj, cuando)).toBe(false);
  });

  it("tampoco lo hace un vuelo que no se ofrece, aunque coincida la aerolínea", () => {
    const aj = { direction: "DEPARTURE", airline: "Aerolíneas Argentinas", number: "AJ324", scheduledAt: new Date("2026-11-24T17:55:00.000Z") };
    expect(esGemeloHorario(proyectado, aj, cuando)).toBe(false);
  });

  it("sí lo es el mismo vuelo publicado con otro código de la misma aerolínea", () => {
    const gemelo = { direction: "DEPARTURE", airline: "Aerolíneas Argentinas", number: "AR1657", scheduledAt: new Date("2026-11-24T17:40:00.000Z") };
    expect(esGemeloHorario(proyectado, gemelo, cuando)).toBe(true);
  });

  it("no lo es si está fuera de la ventana o es del otro sentido", () => {
    const lejos = { direction: "DEPARTURE", airline: "Aerolíneas Argentinas", number: "AR1655", scheduledAt: new Date("2026-11-24T16:00:00.000Z") };
    const otroSentido = { direction: "ARRIVAL", airline: "Aerolíneas Argentinas", number: "AR1656", scheduledAt: new Date("2026-11-24T17:55:00.000Z") };
    expect(esGemeloHorario(proyectado, lejos, cuando)).toBe(false);
    expect(esGemeloHorario(proyectado, otroSentido, cuando)).toBe(false);
  });
});
