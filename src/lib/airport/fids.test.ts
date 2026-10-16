import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estadoSegunHorario, fechaDelTablero, mapFidsStatus, parseFidsBoard, type FidsFlight } from "./fids";

const html = readFileSync(join(__dirname, "__fixtures__", "fids-arribos.html"), "utf8");

describe("tablero del aeropuerto (FIDS)", () => {
  it("lee los vuelos del tablero real", () => {
    const vuelos = parseFidsBoard(html);
    expect(vuelos.length).toBeGreaterThan(0);
    const primero = vuelos[0];
    expect(primero.number).toMatch(/^[A-Z0-9]{2}\d+$/);
    expect(primero.scheduled).toMatch(/^\d{1,2}:\d{2}$/);
    expect(primero.city.length).toBeGreaterThan(0);
  });

  it("saca el nombre de la aerolínea y el número completo", () => {
    const vuelos = parseFidsBoard(html);
    const conNombre = vuelos.find((v) => v.airlineName);
    expect(conNombre?.airlineName).toBeTruthy();
    const jet = vuelos.find((v) => v.number.startsWith("JA"));
    expect(jet?.airlineName?.toLowerCase()).toContain("jet");
  });

  it("traduce los estados del tablero", () => {
    const base: FidsFlight = { airlineCode: "AJ", airlineName: null, number: "AJ324", city: "NQN", scheduled: "13:50", estimated: null, statusText: "", statusClass: "" };
    expect(mapFidsStatus({ ...base, statusText: "Aterrizado", statusClass: "arribado" })).toBe("LANDED");
    expect(mapFidsStatus({ ...base, statusText: "En Vuelo", statusClass: "" })).toBe("EN_ROUTE");
    expect(mapFidsStatus({ ...base, statusText: "Pre Embarque", statusClass: "" })).toBe("SCHEDULED");
    expect(mapFidsStatus({ ...base, statusText: "Demorado", statusClass: "" })).toBe("DELAYED");
    expect(mapFidsStatus({ ...base, statusText: "Cancelado", statusClass: "" })).toBe("CANCELLED");
  });

  it("marca demora por los horarios aunque el tablero no la diga", () => {
    const s = new Date("2026-10-16T16:25:00-03:00");
    // 50 minutos tarde: el tablero dice "Pre Embarque" pero el vuelo está demorado.
    expect(estadoSegunHorario("SCHEDULED", s, new Date("2026-10-16T17:15:00-03:00"))).toBe("DELAYED");
    // 10 minutos: sigue en horario.
    expect(estadoSegunHorario("SCHEDULED", s, new Date("2026-10-16T16:35:00-03:00"))).toBe("SCHEDULED");
    // No pisa un estado ya informado (aterrizó, cancelado) ni la falta de estima.
    expect(estadoSegunHorario("LANDED", s, new Date("2026-10-16T17:15:00-03:00"))).toBe("LANDED");
    expect(estadoSegunHorario("SCHEDULED", s, null)).toBe("SCHEDULED");
  });

  it("ubica la hora en el día correcto", () => {
    const ahora = new Date("2026-10-16T18:00:00.000Z"); // 15:00 local
    expect(fechaDelTablero("18:00", ahora)).toBe("2026-10-16");
    expect(fechaDelTablero("23:30", ahora)).toBe("2026-10-16");
    expect(fechaDelTablero("04:00", ahora)).toBe("2026-10-17"); // madrugada del día siguiente
    expect(fechaDelTablero("cualquiera", ahora)).toBeNull();
  });
});
