import { describe, expect, it } from "vitest";
import { capacidadDeVuelo, combisSugeridas, motivoNoReservable, pasajerosOcupados, rangoDelDia } from "./booking";

const vuelo = (status: string, iso = "2030-01-01T12:00:00Z") => ({ status, scheduledAt: new Date(iso) });
const ahora = new Date("2029-12-31T00:00:00Z");

describe("reserva de aeropuerto", () => {
  it("sólo cuenta pasajeros de reservas vivas", () => {
    expect(pasajerosOcupados([{ passengerCount: 3, status: "PENDING_PAYMENT" }, { passengerCount: 2, status: "CANCELLED" }])).toBe(3);
  });

  it("bloquea cancelado, desviado, pasado y sin cupo", () => {
    expect(motivoNoReservable(vuelo("CANCELLED"), 10, ahora)).toMatch(/cancelado/i);
    expect(motivoNoReservable(vuelo("DIVERTED"), 10, ahora)).toMatch(/desviado/i);
    expect(motivoNoReservable(vuelo("SCHEDULED", "2029-01-01T12:00:00Z"), 10, ahora)).toMatch(/ya salió/i);
    expect(motivoNoReservable(vuelo("SCHEDULED"), 0, ahora)).toMatch(/sin lugares/i);
    expect(motivoNoReservable(vuelo("SCHEDULED"), 5, ahora)).toBeNull();
  });

  it("un vuelo demorado sigue siendo reservable", () => {
    expect(motivoNoReservable(vuelo("DELAYED"), 12, ahora)).toBeNull();
  });

  it("no afirma que un vuelo proyectado ya salió: ese horario era estimado", () => {
    const proyectado = { status: "SCHEDULED", scheduledAt: new Date("2029-01-01T12:00:00Z"), source: "ESTIMADO" };
    expect(motivoNoReservable(proyectado, 10, ahora)).toMatch(/estimado/i);
    expect(motivoNoReservable(proyectado, 10, ahora)).not.toMatch(/ya salió/i);
  });

  it("con dato real de la aerolínea sí avisa que ya salió", () => {
    const real = { status: "SCHEDULED", scheduledAt: new Date("2029-01-01T12:00:00Z"), source: "API" };
    expect(motivoNoReservable(real, 10, ahora)).toMatch(/ya salió/i);
  });

  it("el cupo sale de las combis asignadas (y asume una si no hay)", () => {
    expect(capacidadDeVuelo([])).toBe(24);
    expect(capacidadDeVuelo([{ seats: 24 }])).toBe(24);
    expect(capacidadDeVuelo([{ seats: 24 }, { seats: 15 }])).toBe(39);
  });

  it("sugiere cuántas combis hacen falta según las reservas", () => {
    expect(combisSugeridas(0)).toBe(1);
    expect(combisSugeridas(24)).toBe(1);
    expect(combisSugeridas(25)).toBe(2);
    expect(combisSugeridas(50)).toBe(3);
  });

  it("el rango del día respeta la hora argentina (-03)", () => {
    const { desde, hasta } = rangoDelDia("2026-10-20");
    expect(desde.toISOString()).toBe("2026-10-20T03:00:00.000Z");
    expect(hasta.getTime() - desde.getTime()).toBe(24 * 3600 * 1000);
  });
});
