import { describe, expect, it } from "vitest";
import { capacidadDeVuelo, combisSugeridas, motivoNoReservable, pasajerosOcupados, rangoDelDia } from "./booking";
import { defaultAirportExtras } from "./extras";

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

  it("con demora manda el horario estimado: no bloquea antes de que el avión llegue o salga", () => {
    const demorado = {
      status: "DELAYED",
      scheduledAt: new Date("2029-12-31T12:00:00Z"),
      estimatedAt: new Date("2029-12-31T15:00:00Z"),
      source: "API",
      direction: "ARRIVAL" as const
    };
    // 13:00: ya pasó el horario programado, pero el estimado todavía no.
    expect(motivoNoReservable(demorado, 10, new Date("2029-12-31T13:00:00Z"))).toBeNull();
    // 15:30: ahí sí, el vuelo ya llegó.
    expect(motivoNoReservable(demorado, 10, new Date("2029-12-31T15:30:00Z"))).toMatch(/ya llegó/i);
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

  it("en un arribo dice que ya llegó, no que salió", () => {
    const arribo = {
      status: "LANDED",
      scheduledAt: new Date("2029-01-01T12:00:00Z"),
      source: "FIDS",
      direction: "ARRIVAL" as const
    };
    expect(motivoNoReservable(arribo, 10, ahora)).toMatch(/ya llegó/i);
  });

  it("cierra las reservas de un arribo los minutos configurados antes de aterrizar", () => {
    const arribo = { status: "SCHEDULED", scheduledAt: new Date("2030-01-01T12:00:00Z"), source: "API", direction: "ARRIVAL" as const };
    expect(motivoNoReservable(arribo, 10, new Date("2030-01-01T11:39:00Z"), 20)).toBeNull();
    expect(motivoNoReservable(arribo, 10, new Date("2030-01-01T11:40:00Z"), 20)).toMatch(/cierran 20 min antes/i);
    // Con demora, el corte corre con el horario estimado.
    const demorado = { ...arribo, status: "DELAYED", estimatedAt: new Date("2030-01-01T13:00:00Z") };
    expect(motivoNoReservable(demorado, 10, new Date("2030-01-01T12:30:00Z"), 20)).toBeNull();
    // Las salidas no usan el corte de arribos: 09:00 es antes de que arranque su recorrida
    // (09:30Z), así que la salida sigue abierta aunque el corte de arribos sea 20.
    expect(motivoNoReservable({ ...arribo, direction: "DEPARTURE" as const }, 10, new Date("2030-01-01T09:00:00Z"), 20)).toBeNull();
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

/**
 * Corte de salidas (#55): la combi arranca la recorrida 2 h 30 antes del vuelo (o la hora
 * coordinada a mano) y desde ese momento el pasajero ya no tiene cómo subirse. Antes de este
 * cambio una salida seguía aceptando reservas hasta el horario del vuelo.
 */
describe("corte de reservas de salidas", () => {
  const salida = (iso = "2030-01-01T12:00:00Z", extra: Record<string, unknown> = {}) => ({
    status: "SCHEDULED",
    scheduledAt: new Date(iso),
    direction: "DEPARTURE" as const,
    ...extra
  });

  it("cierra cuando arranca la recorrida, no a la hora del vuelo", () => {
    // Vuelo 12:00Z → recorrida 09:30Z (2 h 30 antes).
    expect(motivoNoReservable(salida(), 10, new Date("2030-01-01T09:00:00Z"))).toBeNull();
    expect(motivoNoReservable(salida(), 10, new Date("2030-01-01T09:30:00Z"))).toMatch(/recorrida ya arrancó/i);
    // Antes se podía reservar hasta las 12:00; ahora no.
    expect(motivoNoReservable(salida(), 10, new Date("2030-01-01T11:00:00Z"))).toMatch(/recorrida ya arrancó/i);
  });

  it("respeta la hora coordinada a mano del vuelo", () => {
    const coordinada = salida("2030-01-01T12:00:00Z", { pickupStartOverrideAt: new Date("2030-01-01T11:00:00Z") });
    expect(motivoNoReservable(coordinada, 10, new Date("2030-01-01T10:30:00Z"))).toBeNull();
    expect(motivoNoReservable(coordinada, 10, new Date("2030-01-01T11:00:00Z"))).toMatch(/recorrida ya arrancó/i);
  });

  it("con minutos de gracia configurados cierra antes del arranque", () => {
    // 15 minutos antes de las 09:30 → 09:15.
    expect(motivoNoReservable(salida(), 10, new Date("2030-01-01T09:10:00Z"), 0, 15)).toBeNull();
    expect(motivoNoReservable(salida(), 10, new Date("2030-01-01T09:20:00Z"), 0, 15)).toMatch(/cierran 15 min antes/i);
  });

  it("con demora la recorrida se corre con el horario estimado", () => {
    const demorado = salida("2030-01-01T12:00:00Z", {
      status: "DELAYED",
      estimatedAt: new Date("2030-01-01T15:00:00Z"),
      source: "API"
    });
    // Recorrida real 12:30Z: a las 10:00 todavía se puede reservar, aunque con el programado ya habría arrancado.
    expect(motivoNoReservable(demorado, 10, new Date("2030-01-01T10:00:00Z"))).toBeNull();
    expect(motivoNoReservable(demorado, 10, new Date("2030-01-01T12:45:00Z"))).toMatch(/recorrida ya arrancó/i);
  });

  it("con un adelanto informado cierra antes: el avión sale más temprano y la recorrida también", () => {
    const adelantado = salida("2030-01-01T12:00:00Z", {
      estimatedAt: new Date("2030-01-01T11:00:00Z"),
      source: "API"
    });
    // Recorrida real 08:30Z (una hora antes de la programada): a las 08:45 ya no se puede reservar.
    expect(motivoNoReservable(adelantado, 10, new Date("2030-01-01T08:00:00Z"))).toBeNull();
    expect(motivoNoReservable(adelantado, 10, new Date("2030-01-01T08:45:00Z"))).toMatch(/recorrida ya arrancó/i);
  });

  it("un vuelo que ya salió sigue avisando eso, no la recorrida", () => {
    expect(motivoNoReservable(salida(), 10, new Date("2030-01-01T13:00:00Z"))).toMatch(/ya salió/i);
  });

  it("no toca los arribos: un arribo no tiene recorrida previa", () => {
    const arribo = { status: "SCHEDULED", scheduledAt: new Date("2030-01-01T12:00:00Z"), direction: "ARRIVAL" as const };
    // 2 h 30 antes del aterrizaje: con corte de arribos en 0 sigue reservable.
    expect(motivoNoReservable(arribo, 10, new Date("2030-01-01T09:30:00Z"))).toBeNull();
  });

  it("el corte de salida viene apagado por defecto en la configuración", () => {
    // 0 = cierre exacto al arranque de la recorrida (no se puede desactivar desde el panel).
    expect(defaultAirportExtras.departureCutoffMinutes).toBe(0);
  });
});
