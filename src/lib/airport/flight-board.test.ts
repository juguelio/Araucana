import { describe, expect, it } from "vitest";
import { horaDeReferencia, MARGEN_SIN_CONFIRMAR_MIN, MARGEN_TERMINADO_MIN, separarVuelosDelTablero, vueloTerminado } from "./flight-board";

const ahora = new Date("2026-11-12T18:00:00.000Z");
const enMinutos = (min: number) => new Date(ahora.getTime() + min * 60000);

function vuelo(overrides: Partial<{ status: string; scheduledAt: Date; estimatedAt: Date | null }> = {}) {
  return { status: "SCHEDULED", scheduledAt: enMinutos(-60), estimatedAt: null, ...overrides };
}

describe("vuelo terminado", () => {
  it("un vuelo aterrizado ya pasó aunque sea reciente", () => {
    expect(vueloTerminado(vuelo({ status: "LANDED", scheduledAt: enMinutos(5) }), ahora)).toBe(true);
  });

  it("sin confirmación, una hora vencida no prueba que terminó", () => {
    expect(vueloTerminado(vuelo({ scheduledAt: enMinutos(-(MARGEN_TERMINADO_MIN + 1)) }), ahora)).toBe(false);
    expect(vueloTerminado(vuelo({ scheduledAt: enMinutos(-(MARGEN_TERMINADO_MIN - 1)) }), ahora)).toBe(false);
  });

  it("manda el horario estimado: un vuelo demorado sigue en juego", () => {
    const demorado = vuelo({ status: "DELAYED", scheduledAt: enMinutos(-150), estimatedAt: enMinutos(20) });
    expect(horaDeReferencia(demorado)).toEqual(enMinutos(20));
    expect(vueloTerminado(demorado, ahora)).toBe(false);
  });

  it("cancelado y desviado no bajan aunque su hora ya haya pasado", () => {
    // Son imprevistos: la operación los tiene que seguir viendo, no esconderlos en el pie.
    expect(vueloTerminado(vuelo({ status: "CANCELLED", scheduledAt: enMinutos(-300) }), ahora)).toBe(false);
    expect(vueloTerminado(vuelo({ status: "DIVERTED", scheduledAt: enMinutos(-300) }), ahora)).toBe(false);
  });
});

describe("separar vuelos del tablero", () => {
  it("deja arriba lo que falta, con el más cercano primero, y manda lo pasado abajo", () => {
    const { enJuego, terminados } = separarVuelosDelTablero(
      [
        vuelo({ status: "LANDED", scheduledAt: enMinutos(-120) }),
        vuelo({ scheduledAt: enMinutos(120) }),
        vuelo({ scheduledAt: enMinutos(-200) }),
        vuelo({ scheduledAt: enMinutos(30) })
      ],
      ahora
    );

    expect(enJuego.map((v) => v.scheduledAt)).toEqual([enMinutos(30), enMinutos(120)]);
    expect(terminados.map((v) => v.scheduledAt)).toEqual([enMinutos(-120)]);
  });

  it("lo que pasó hace un rato y nadie confirmó queda por verificar", () => {
    const { enJuego, terminados, porVerificar } = separarVuelosDelTablero(
      [vuelo({ scheduledAt: enMinutos(-(MARGEN_TERMINADO_MIN + 30)) }), vuelo({ scheduledAt: enMinutos(-150) })],
      ahora
    );

    expect(enJuego).toHaveLength(0);
    expect(terminados).toHaveLength(0);
    expect(porVerificar).toHaveLength(2);
  });

  it("lo que pasó hace horas baja al pie aunque la fuente nunca lo confirme", () => {
    // El caso real: Chapelco en temporada baja, o AirLabs caído. Sin tope, el día entero se
    // apilaba en «Por verificar» y tapaba los vuelos que sí seguían en juego.
    const { enJuego, terminados, porVerificar } = separarVuelosDelTablero(
      [vuelo({ scheduledAt: enMinutos(-600) }), vuelo({ scheduledAt: enMinutos(-(MARGEN_SIN_CONFIRMAR_MIN + 60)) })],
      ahora
    );

    expect(porVerificar).toHaveLength(0);
    expect(terminados).toHaveLength(2);
    expect(enJuego).toHaveLength(0);
  });

  it("el tope es sobre la hora de referencia: un demorado sigue arriba", () => {
    const demorado = vuelo({ status: "DELAYED", scheduledAt: enMinutos(-300), estimatedAt: enMinutos(45) });
    const { enJuego, porVerificar } = separarVuelosDelTablero([demorado], ahora);
    expect(porVerificar).toHaveLength(0);
    expect(enJuego).toHaveLength(1);
  });

  it("no muta la lista que recibe", () => {
    const original = [vuelo({ scheduledAt: enMinutos(60) }), vuelo({ scheduledAt: enMinutos(10) })];
    separarVuelosDelTablero(original, ahora);
    expect(original.map((v) => v.scheduledAt)).toEqual([enMinutos(60), enMinutos(10)]);
  });
});
