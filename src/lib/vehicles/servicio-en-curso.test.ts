import { describe, expect, it } from "vitest";
import { proximoYHoy, type ServicioDeNave } from "./servicio-en-curso";

const servicio = (key: string, desde: string, hasta: string | null, extra: Partial<ServicioDeNave> = {}): ServicioDeNave => ({
  key,
  area: "SALIDA",
  desde: new Date(desde),
  hasta: hasta ? new Date(hasta) : null,
  soloDia: false,
  titulo: key,
  detalle: null,
  chofer: null,
  estado: null,
  href: null,
  ventana: hasta ? { desde: new Date(desde), hasta: new Date(hasta) } : null,
  ...extra
});

// Sábado 21-nov, salidas reales de Traful: ida 10:00 → 12:15, vuelta 15:45 → 18:00 (hora de Argentina).
const ida = servicio("ida", "2026-11-21T13:00:00Z", "2026-11-21T15:15:00Z");
const vuelta = servicio("vuelta", "2026-11-21T18:45:00Z", "2026-11-21T21:00:00Z");

describe("proximoYHoy: qué hace la nave ahora y qué sigue (cruce del 20-nov)", () => {
  it("durante la ida está en recorrido y lo próximo es la vuelta", () => {
    const r = proximoYHoy([ida, vuelta], new Date("2026-11-21T14:00:00Z"));
    expect(r.enCurso?.key).toBe("ida");
    expect(r.proximo?.key).toBe("vuelta");
    expect(r.hoy).toBe(2);
  });

  it("antes de salir no está en recorrido; al llegar, tampoco", () => {
    expect(proximoYHoy([ida, vuelta], new Date("2026-11-21T12:59:00Z")).enCurso).toBeNull();
    expect(proximoYHoy([ida, vuelta], new Date("2026-11-21T15:15:00Z")).enCurso).toBeNull();
  });

  it("un vuelo de partida está en curso desde la recorrida, aunque el vuelo sea después", () => {
    // Recorrida 9:30, vuelo 11:00: a las 10:00 la combi ya está buscando pasajeros.
    const vuelo = servicio("vuelo", "2026-11-21T14:00:00Z", null, {
      area: "AEROPUERTO",
      ventana: { desde: new Date("2026-11-21T12:30:00Z"), hasta: new Date("2026-11-21T14:00:00Z") }
    });
    const r = proximoYHoy([vuelo, vuelta], new Date("2026-11-21T13:00:00Z"));
    expect(r.enCurso?.key).toBe("vuelo");
    expect(r.proximo?.key).toBe("vuelta");
  });

  it("Chapelco (día entero) no cuenta como recorrido, pero sí como servicio de hoy", () => {
    const cerro = servicio("cerro", "2026-11-21T00:00:00Z", null, { area: "CHAPELCO", soloDia: true });
    const r = proximoYHoy([cerro], new Date("2026-11-21T15:00:00Z"));
    expect(r.enCurso).toBeNull();
    expect(r.hoy).toBe(1);
    expect(r.proximo?.key).toBe("cerro");
  });

  it("sin servicios no hay nada", () => {
    expect(proximoYHoy(undefined, new Date())).toMatchObject({ enCurso: null, proximo: null, hoy: 0 });
  });
});
