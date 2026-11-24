import { describe, expect, it } from "vitest";
import { createReservationSchema } from "@/lib/booking/validation";
import { adminAirportReservationSchema, airportReservationSchema, airportRoundTripSchema } from "./validation";

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

describe("el documento en el aeropuerto es opcional (#206, #208)", () => {
  const sinDni = { ...reserva, passenger: { ...reserva.passenger, documentId: "" } };
  const sinCampo = { ...reserva, passenger: (({ documentId: _omitido, ...resto }) => resto)(reserva.passenger) };

  it("la reserva pública acepta el documento vacío o ausente", () => {
    expect(airportReservationSchema.safeParse(sinDni).success).toBe(true);
    const parsed = airportReservationSchema.safeParse(sinCampo);
    expect(parsed.success && parsed.data.passenger.documentId).toBe("");
  });

  it("la reserva del panel acepta el documento vacío", () => {
    expect(adminAirportReservationSchema.safeParse(sinDni).success).toBe(true);
  });

  it("si el documento viene, se sigue validando y normalizando", () => {
    const mal = { ...reserva, passenger: { ...reserva.passenger, documentId: "12" } };
    expect(airportReservationSchema.safeParse(mal).success).toBe(false);
    expect(adminAirportReservationSchema.safeParse(mal).success).toBe(false);
    const conPuntos = { ...reserva, passenger: { ...reserva.passenger, documentId: "30.123.456" } };
    const parsed = airportReservationSchema.safeParse(conPuntos);
    expect(parsed.success && parsed.data.passenger.documentId).toBe("30123456");
  });
});

describe("el email en el aeropuerto es opcional (#239)", () => {
  const sinEmail = { ...reserva, passenger: { ...reserva.passenger, email: "" } };
  const sinCampo = { ...reserva, passenger: (({ email: _omitido, ...resto }) => resto)(reserva.passenger) };

  it("la reserva pública acepta el email vacío o ausente y lo guarda vacío", () => {
    expect(airportReservationSchema.safeParse(sinEmail).success).toBe(true);
    const parsed = airportReservationSchema.safeParse(sinCampo);
    expect(parsed.success && parsed.data.passenger.email).toBe("");
  });

  it("si el email viene, se sigue validando", () => {
    const mal = { ...reserva, passenger: { ...reserva.passenger, email: "ana@" } };
    expect(airportReservationSchema.safeParse(mal).success).toBe(false);
    expect(adminAirportReservationSchema.safeParse(mal).success).toBe(false);
  });

  it("el ida y vuelta público también lo acepta vacío", () => {
    const tramo = { flightNumber: "AR1656", serviceDate: "2026-11-13" };
    const idaYVuelta = {
      routeSlug: "aeropuerto-chapelco-sma",
      passenger: sinEmail.passenger,
      arrival: tramo,
      departure: { ...tramo, flightNumber: "AR1657", serviceDate: "2026-11-20" }
    };
    const parsed = airportRoundTripSchema.safeParse(idaYVuelta);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.passenger.email).toBe("");
  });

  it("las rutas y Chapelco lo siguen exigiendo", () => {
    const salida = { scheduleId: "salida-1", passengerCount: 1 };
    expect(createReservationSchema.safeParse({ ...salida, passenger: sinEmail.passenger }).success).toBe(false);
    expect(createReservationSchema.safeParse({ ...salida, passenger: reserva.passenger }).success).toBe(true);
  });
});

it("valida las paradas y el precio privado sólo en administración", () => {
  const privateTransfer = { stops: [{ destination: "Villa Traful", passengers: 5 }], totalCents: 400000 };
  const input = { ...reserva, passengerCount: 5, privateTransfer };
  expect(adminAirportReservationSchema.parse(input).privateTransfer).toEqual(privateTransfer);
  expect(airportReservationSchema.parse(input)).not.toHaveProperty("privateTransfer");
  expect(adminAirportReservationSchema.safeParse({ ...input, passengerCount: 4 }).success).toBe(false);
  expect(adminAirportReservationSchema.safeParse({ ...input, privateTransfer: { stops: privateTransfer.stops } }).success).toBe(false);
});
