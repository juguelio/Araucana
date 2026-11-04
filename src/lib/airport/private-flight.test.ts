import { describe, expect, it } from "vitest";
import { claveDeVuelo, elegirVueloExistente, esDelDia, horarioLocal } from "./booking";
import { airportReservationSchema, privateFlightSchema } from "./validation";

/**
 * Vuelo privado (charter / avión particular): el pasajero lo carga porque no figura en la lista del
 * día. Lo que se prueba acá es lo que decide si se duplica un vuelo o se comparte su cupo.
 */

const pasajero = {
  firstName: "Ana",
  lastName: "Paz",
  email: "ana@ejemplo.com",
  phone: "+5492944000000",
  documentType: "DNI",
  documentId: "30111222",
  nationality: "Argentina"
};

const reserva = {
  routeSlug: "aeropuerto-chapelco-sma",
  flightNumber: "LV-BET",
  direction: "ARRIVAL" as const,
  serviceDate: "2026-11-05",
  passengerCount: 2,
  passenger: pasajero
};

describe("vuelo privado: normalización", () => {
  it("compara el número sin espacios, guiones ni mayúsculas", () => {
    expect(claveDeVuelo("LV-BET ")).toBe("LVBET");
    expect(claveDeVuelo(" ar 1656")).toBe("AR1656");
    expect(claveDeVuelo("lv bet")).toBe("LVBET");
  });

  it("arma el horario en hora argentina, no en UTC", () => {
    expect(horarioLocal("2026-11-05", "14:30").toISOString()).toBe("2026-11-05T17:30:00.000Z");
    expect(horarioLocal("2026-11-05", "14:30:00").toISOString()).toBe("2026-11-05T17:30:00.000Z");
  });

  it("reconoce el día del servicio en hora argentina (23:30 sigue siendo el mismo día)", () => {
    expect(esDelDia("2026-11-05", horarioLocal("2026-11-05", "23:30"))).toBe(true);
    expect(esDelDia("2026-11-05", horarioLocal("2026-11-06", "00:30"))).toBe(false);
    expect(esDelDia("2026-11-05", horarioLocal("2026-11-04", "23:59"))).toBe(false);
  });
});

describe("vuelo privado: dos pasajeros del mismo charter", () => {
  const vuelos = [
    { number: "LV-BET", scheduledAt: new Date("2026-11-05T12:00:00Z") },
    { number: "LVBET", scheduledAt: new Date("2026-11-05T15:00:00Z") },
    { number: "LV-ABC", scheduledAt: new Date("2026-11-05T14:00:00Z") }
  ];

  it("reutiliza el vuelo del mismo avión en vez de crear otro", () => {
    expect(elegirVueloExistente(vuelos, "lv bet", new Date("2026-11-05T15:10:00Z"))?.scheduledAt.toISOString()).toBe(
      "2026-11-05T15:00:00.000Z"
    );
  });

  it("elige el horario más parecido cuando el mismo avión figura dos veces", () => {
    expect(elegirVueloExistente(vuelos, "LV-BET", new Date("2026-11-05T11:40:00Z"))?.scheduledAt.toISOString()).toBe(
      "2026-11-05T12:00:00.000Z"
    );
  });

  it("no mezcla aviones distintos", () => {
    expect(elegirVueloExistente(vuelos, "LV-XYZ", new Date("2026-11-05T14:00:00Z"))).toBeNull();
    expect(elegirVueloExistente([], "LV-BET", new Date("2026-11-05T14:00:00Z"))).toBeNull();
  });
});

describe("vuelo privado: contrato del pedido", () => {
  it("acepta número o matrícula y un horario ISO con offset", () => {
    const parsed = privateFlightSchema.parse({ number: " LV-BET ", scheduledAt: "2026-11-05T14:30:00-03:00" });
    expect(parsed.number).toBe("LV-BET");
  });

  it("rechaza un número demasiado corto y un horario inválido", () => {
    expect(privateFlightSchema.safeParse({ number: "L", scheduledAt: "2026-11-05T14:30:00-03:00" }).success).toBe(false);
    expect(privateFlightSchema.safeParse({ number: "LV-BET", scheduledAt: "mañana a la tarde" }).success).toBe(false);
  });

  it("la reserva sigue siendo válida sin vuelo privado (no rompe el flujo de la lista)", () => {
    expect(airportReservationSchema.safeParse(reserva).success).toBe(true);
  });

  it("la reserva acepta el vuelo privado como parte del pedido", () => {
    const ok = airportReservationSchema.safeParse({
      ...reserva,
      privateFlight: { number: "LV-BET", airline: "Fly Patagonia", origin: "Buenos Aires", scheduledAt: "2026-11-05T14:30:00-03:00" }
    });
    expect(ok.success).toBe(true);
  });

  it("rechaza un vuelo privado incompleto aunque el resto del pedido esté bien", () => {
    expect(
      airportReservationSchema.safeParse({ ...reserva, privateFlight: { number: "", scheduledAt: "2026-11-05T14:30:00-03:00" } })
        .success
    ).toBe(false);
  });
});
