import { describe, expect, it } from "vitest";
import {
  diaArgentino,
  hayLugar,
  lugaresLibres,
  personasQueBloqueanLaFranja,
  restoredStatus,
  servicioYaPaso,
  vueloYaPaso
} from "./restore";

const DISABILITY = "DISABILITY_DOCUMENT";

describe("restitución de una reserva cancelada (#117)", () => {
  it("vuelve al estado que corresponde según el pago, sin inventar uno nuevo", () => {
    expect(restoredStatus({ payment: { status: "APPROVED", provider: "MANUAL" }, disabilityProvider: DISABILITY })).toBe("CONFIRMED");
    expect(restoredStatus({ payment: { status: "PENDING", provider: "MANUAL" }, disabilityProvider: DISABILITY })).toBe("PENDING_PAYMENT");
    expect(restoredStatus({ payment: null, disabilityProvider: DISABILITY })).toBe("PENDING_PAYMENT");
    // Una reserva sin cargo con documentación por revisar vuelve a ese estado, no a «confirmada».
    expect(restoredStatus({ payment: { status: "PENDING", provider: DISABILITY }, disabilityProvider: DISABILITY })).toBe("DOCUMENTATION_PENDING");
  });

  it("cuenta pasajeros, no filas: una reserva puede ocupar varios lugares", () => {
    expect(hayLugar(10, 6, 4)).toBe(true);
    expect(hayLugar(10, 7, 4)).toBe(false);
    expect(hayLugar(10, 0, 0)).toBe(false);
    expect(lugaresLibres(10, 12)).toBe(0);
    expect(lugaresLibres(10, 3)).toBe(7);
  });

  it("un servicio de hoy se puede restituir; el de ayer no", () => {
    // 13/11/2026 16:30 en Argentina (UTC−3) = 19:30Z.
    const ahora = new Date("2026-11-13T19:30:00.000Z");
    expect(diaArgentino(ahora)).toBe("2026-11-13");
    // A las 22:00 de Argentina ya es 14/11 en UTC: el día argentino sigue siendo el 13.
    expect(diaArgentino(new Date("2026-11-14T01:00:00.000Z"))).toBe("2026-11-13");
    expect(servicioYaPaso(new Date("2026-11-13T00:00:00.000Z"), ahora)).toBe(false);
    expect(servicioYaPaso(new Date("2026-11-14T00:00:00.000Z"), ahora)).toBe(false);
    expect(servicioYaPaso(new Date("2026-11-12T00:00:00.000Z"), ahora)).toBe(true);
  });

  it("con demora manda el horario estimado para saber si el vuelo ya pasó", () => {
    const ahora = new Date("2026-11-13T19:30:00.000Z");
    const programado = new Date("2026-11-13T19:00:00.000Z");
    expect(vueloYaPaso({ scheduledAt: programado, estimatedAt: null }, ahora)).toBe(true);
    // Demorado 40 minutos: a la hora programada todavía no salió.
    expect(vueloYaPaso({ scheduledAt: programado, estimatedAt: new Date("2026-11-13T19:40:00.000Z") }, ahora)).toBe(false);
    expect(vueloYaPaso({ scheduledAt: programado, estimatedAt: new Date("2026-11-13T19:10:00.000Z") }, ahora)).toBe(true);
  });

  it("cuenta el cupo de Chapelco con las franjas que se pisan, igual que el alta", () => {
    const reservas = [
      { passengerCount: 4, ascentSlot: "08:30" },
      { passengerCount: 2, ascentSlot: "12:00" },
      { passengerCount: 9, ascentSlot: "no-es-una-franja" }
    ];
    expect(personasQueBloqueanLaFranja(reservas, "08:30")).toBe(4);
    // 09:00 se pisa con 08:30 y con 10:30; 12:00 queda lejos.
    expect(personasQueBloqueanLaFranja(reservas, "09:00")).toBe(4);
    expect(personasQueBloqueanLaFranja(reservas, "12:00")).toBe(2);
  });
});


it("conserva la aprobación de documentación al restituir", () => {
  expect(restoredStatus({ payment: { status: "APPROVED", provider: DISABILITY }, disabilityProvider: DISABILITY })).toBe("CONFIRMED");
});
