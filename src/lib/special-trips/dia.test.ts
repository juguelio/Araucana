import { describe, expect, it } from "vitest";
import { asignacionesDelDia, fechaInicialDeAlta, navesDelDia, salidaDelDia } from "./dia";

/** Un instante en hora argentina, como lo guarda Prisma. */
const art = (iso: string) => new Date(`${iso}-03:00`);
const nave = (name: string) => ({ vehicle: { name } });

// El caso del issue #443: un servicio que arranca 22:30 ART.
const nocturno = { ...nave("Combi 4"), startsAt: art("2026-11-25T22:30"), endsAt: art("2026-11-25T23:30") };
// Y el que sale 22:00 ART del día anterior: con la ventana UTC se colaba en el día siguiente.
const víspera = { ...nave("Combi 7"), startsAt: art("2026-11-24T22:00"), endsAt: art("2026-11-24T23:00") };
// Viaje de varios días: una sola asignación que cubre el bloque entero.
const variosDias = { ...nave("Minibús 2"), startsAt: art("2026-11-20T08:00"), endsAt: art("2026-11-23T20:00") };

describe("día del viaje especial: la ventana de las naves es la argentina", () => {
  it("un servicio de 22:30 ART cuenta en su propio día", () => {
    expect(asignacionesDelDia([nocturno], "2026-11-25")).toEqual([nocturno]);
    expect(navesDelDia([nocturno], "2026-11-25")).toEqual(["Combi 4"]);
  });

  it("no se cuela en el día siguiente ni se pierde en el anterior", () => {
    expect(asignacionesDelDia([nocturno], "2026-11-26")).toEqual([]);
    expect(navesDelDia([nocturno], "2026-11-24")).toEqual([]);
  });

  it("el servicio de las 22:00 del día anterior no aparece en el día que no es suyo", () => {
    expect(navesDelDia([víspera], "2026-11-25")).toEqual([]);
    expect(navesDelDia([víspera], "2026-11-24")).toEqual(["Combi 7"]);
  });

  it("un bloque de varios días figura en cada día que ocupa", () => {
    expect(navesDelDia([variosDias], "2026-11-21")).toEqual(["Minibús 2"]);
    expect(navesDelDia([variosDias], "2026-11-20")).toEqual(["Minibús 2"]);
    expect(navesDelDia([variosDias], "2026-11-19")).toEqual([]);
    expect(navesDelDia([variosDias], "2026-11-24")).toEqual([]);
  });

  it("la columna Nave no repite una combi asignada dos veces el mismo día", () => {
    const dosVeces = { ...nocturno, startsAt: art("2026-11-25T08:00"), endsAt: art("2026-11-25T10:00") };
    expect(navesDelDia([nocturno, dosVeces], "2026-11-25")).toEqual(["Combi 4"]);
  });

  it("«Sale» sólo marca la asignación que arranca ese día", () => {
    expect(salidaDelDia([nocturno], "2026-11-25")).toBe(nocturno);
    expect(salidaDelDia([nocturno], "2026-11-26")).toBeNull();
    // El bloque que viene del día anterior no es una salida del día.
    expect(salidaDelDia([variosDias], "2026-11-21")).toBeNull();
    expect(salidaDelDia([variosDias], "2026-11-20")).toBe(variosDias);
  });
});

describe("fecha inicial del alta de un viaje especial", () => {
  // 02:30Z del 25/11 = 23:30 ART del 24/11: el «hoy» del operador.
  const ahora = new Date("2026-11-25T02:30:00Z");

  it("respeta la fecha del día que se estaba mirando", () => {
    expect(fechaInicialDeAlta("2026-12-03", ahora)).toBe("2026-12-03");
  });

  it("sin parámetro abre en hoy, en hora argentina y no en UTC", () => {
    expect(fechaInicialDeAlta(undefined, ahora)).toBe("2026-11-24");
  });

  it("una fecha inválida o repetida cae a hoy en vez de romper el formulario", () => {
    expect(fechaInicialDeAlta("2026-13-45", ahora)).toBe("2026-11-24");
    expect(fechaInicialDeAlta("2026-02-30", ahora)).toBe("2026-11-24");
    expect(fechaInicialDeAlta("<script>", ahora)).toBe("2026-11-24");
    expect(fechaInicialDeAlta(["2026-12-03", "2026-12-04"], ahora)).toBe("2026-11-24");
  });
});
