import { describe, expect, it } from "vitest";
import { adminAirportReservationSchema, airportReservationSchema } from "./validation";

/** Reserva pública mínima y válida: se le agrega un campo por test. */
const reserva = {
  routeSlug: "aeropuerto-chapelco-sma",
  flightNumber: "JA3181",
  direction: "ARRIVAL" as const,
  serviceDate: "2026-11-13",
  passengerCount: 1,
  passenger: {
    firstName: "Ana",
    lastName: "Pérez",
    email: "ana@example.com",
    phone: "+54 9 2944 123456",
    documentType: "DNI",
    documentId: "30123456",
    nationality: "Argentina"
  }
};

describe("contrato de la reserva de aeropuerto", () => {
  it("la reserva pública ignora el precio que mande el turista", () => {
    // El cliente lo pidió explícito: la tarifa la fija Araucana, no el pasajero. Si alguien agrega
    // `overrideTotalCents` al schema público, este test se cae.
    const parsed = airportReservationSchema.safeParse({ ...reserva, overrideTotalCents: 1 });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "overrideTotalCents" in parsed.data).toBe(false);
  });

  it("el origen de la venta lo carga sólo el panel, no el formulario público (#109)", () => {
    const publica = airportReservationSchema.safeParse({ ...reserva, referredBy: "Agencia Los Andes" });
    expect(publica.success).toBe(true);
    expect(publica.success && "referredBy" in publica.data).toBe(false);

    const panel = adminAirportReservationSchema.safeParse({ ...reserva, referredBy: "  Agencia Los Andes  " });
    expect(panel.success).toBe(true);
    expect(panel.success && panel.data.referredBy).toBe("Agencia Los Andes");
    // Sin el dato la reserva se vendió directo: no se inventa un origen ni se rompe el alta.
    const sinOrigen = adminAirportReservationSchema.safeParse(reserva);
    expect(sinOrigen.success).toBe(true);
    expect(sinOrigen.success && sinOrigen.data.referredBy).toBeUndefined();
    expect(adminAirportReservationSchema.safeParse({ ...reserva, referredBy: "x".repeat(121) }).success).toBe(false);
  });

  it("sólo el alta desde el panel acepta un precio a medida", () => {
    const parsed = adminAirportReservationSchema.safeParse({ ...reserva, overrideTotalCents: 450_000 });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.overrideTotalCents).toBe(450_000);
  });

  it("el turista sí elige bultos de equipaje deportivo: el monto lo calcula el servidor", () => {
    const parsed = airportReservationSchema.safeParse({ ...reserva, sportsLuggageCount: 2 });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.sportsLuggageCount).toBe(2);
    expect(parsed.success && "zoneExtraCents" in parsed.data).toBe(false);
  });

  it("no acepta bultos negativos ni más de 24", () => {
    expect(airportReservationSchema.safeParse({ ...reserva, sportsLuggageCount: -1 }).success).toBe(false);
    expect(airportReservationSchema.safeParse({ ...reserva, sportsLuggageCount: 25 }).success).toBe(false);
  });
});
