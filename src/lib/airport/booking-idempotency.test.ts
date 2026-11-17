import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Idempotencia del alta de reservas (#139).
 *
 * El caso que fija este test: el pasajero completa el formulario, el servidor crea la reserva y la
 * respuesta se pierde (corte de red, doble click, refresh). El reintento llega con **la misma
 * clave** y tiene que devolver la reserva que ya existe, sin crear otra ni ocupar un segundo lugar.
 */

const mocks = {
  findUniqueRoute: vi.fn(),
  findManyFlights: vi.fn(),
  findFirstRoute: vi.fn(),
  createPassenger: vi.fn(),
  createReservation: vi.fn(),
  createPayment: vi.fn(),
  transaction: vi.fn(),
  findUniqueReservation: vi.fn(),
  findManyReservations: vi.fn()
};

const settings = vi.hoisted(() => ({
  extras: { zoneExtraCents: 0, sportsLuggageCents: 0, arrivalCutoffMinutes: 0, departureCutoffMinutes: 0 },
  coverage: {
    enabled: false,
    boundary: [] as Array<[number, number]>,
    exclusions: [] as Array<Array<[number, number]>>,
    extraBoundary: [] as Array<[number, number]>
  }
}));
vi.mock("./extras-settings", () => ({ getAirportExtras: async () => settings.extras }));
vi.mock("./pickup-zone-settings", () => ({ getAirportCoverage: async () => settings.coverage }));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    travelRoute: { findUnique: (...a: unknown[]) => mocks.findUniqueRoute(...a) },
    reservation: {
      findUnique: (...a: unknown[]) => mocks.findUniqueReservation(...a),
      findMany: (...a: unknown[]) => mocks.findManyReservations(...a)
    },
    $transaction: (...a: unknown[]) => mocks.transaction(...a)
  }
}));

const { createAirportReservation, createAirportRoundTripReservation } = await import("./booking");

/** El teléfono se arma por partes: copiarlo de una salida de herramienta trae caracteres de más. */
const telefono = ["+549", "2944", "556677"].join("");

const pasajero = {
  firstName: "Ana",
  lastName: "Gomez",
  email: "ana@example.com",
  phone: telefono,
  documentType: "DNI",
  documentId: "30111222",
  nationality: "Argentina"
};

const reservaDeUnTramo = {
  routeSlug: "aeropuerto-chapelco-sma",
  flightNumber: "AR1656",
  direction: "ARRIVAL" as const,
  serviceDate: "2030-01-01",
  passengerCount: 1,
  passenger: pasajero
};

const reservaDeIdaYVuelta = {
  routeSlug: "aeropuerto-chapelco-sma",
  firstLeg: "ARRIVAL" as const,
  passengerCount: 1,
  passenger: pasajero,
  arrival: { flightNumber: "AR1656", serviceDate: "2030-01-01" },
  departure: { flightNumber: "AR1657", serviceDate: "2030-01-05" }
};

const vuelo = (id: string, number: string, direction: "ARRIVAL" | "DEPARTURE", iso: string) => ({
  id,
  number,
  direction,
  status: "SCHEDULED",
  scheduledAt: new Date(iso),
  reservations: [],
  assignments: []
});

beforeEach(() => {
  vi.clearAllMocks();
  settings.extras = { zoneExtraCents: 0, sportsLuggageCents: 0, arrivalCutoffMinutes: 0, departureCutoffMinutes: 0 };
  mocks.findUniqueRoute.mockResolvedValue({
    id: "ruta-1",
    slug: "aeropuerto-chapelco-sma",
    isActive: true,
    bookingMode: "AIRPORT",
    priceCents: 2500000,
    currency: "ARS"
  });
  mocks.findManyFlights.mockImplementation(async (args: { where?: { direction?: string } }) => {
    if (args?.where?.direction === "ARRIVAL") return [vuelo("vuelo-arr", "AR1656", "ARRIVAL", "2030-01-01T18:45:00Z")];
    if (args?.where?.direction === "DEPARTURE") return [vuelo("vuelo-dep", "AR1657", "DEPARTURE", "2030-01-05T18:45:00Z")];
    return [];
  });
  mocks.findFirstRoute.mockResolvedValue({ id: "ruta-1" });
  mocks.createPassenger.mockResolvedValue({ id: "pax-1" });
  mocks.createReservation.mockImplementation(async (args: { data: { idempotencyKey?: string | null } }) => ({
    id: `res-${mocks.createReservation.mock.calls.length}`,
    code: "ARC-3001-ABCDEF",
    idempotencyKey: args.data.idempotencyKey ?? null,
    totalCents: 5000000,
    currency: "ARS"
  }));
  mocks.createPayment.mockResolvedValue({ id: "pago-1" });
  mocks.findUniqueReservation.mockResolvedValue(null);
  mocks.findManyReservations.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      flight: { findMany: (...a: unknown[]) => mocks.findManyFlights(...a) },
      travelRoute: { findFirst: (...a: unknown[]) => mocks.findFirstRoute(...a) },
      passenger: { create: (...a: unknown[]) => mocks.createPassenger(...a) },
      reservation: { create: (...a: unknown[]) => mocks.createReservation(...a) },
      payment: { create: (...a: unknown[]) => mocks.createPayment(...a) }
    })
  );
});

describe("alta de un tramo: reintento con la misma clave", () => {
  it("devuelve la reserva que ya existe y no crea otra", async () => {
    const yaCreada = { id: "res-1", code: "ARC-3001-ABCDEF", totalCents: 5000000, currency: "ARS" };
    mocks.findUniqueReservation.mockResolvedValue(yaCreada);

    const devuelta = await createAirportReservation({ ...reservaDeUnTramo, idempotencyKey: "intento-1" });

    expect(devuelta).toBe(yaCreada);
    expect(mocks.findUniqueReservation).toHaveBeenCalledWith(expect.objectContaining({ where: { idempotencyKey: "intento-1" } }));
    expect(mocks.createPassenger).not.toHaveBeenCalled();
    expect(mocks.createReservation).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("sin clave no busca nada y crea la reserva como siempre (clave nula)", async () => {
    await createAirportReservation(reservaDeUnTramo);

    expect(mocks.findUniqueReservation).not.toHaveBeenCalled();
    expect(mocks.createReservation).toHaveBeenCalledTimes(1);
    expect(mocks.createReservation.mock.calls[0][0].data.idempotencyKey).toBeNull();
  });

  it("la clave del intento queda guardada en la reserva nueva", async () => {
    await createAirportReservation({ ...reservaDeUnTramo, idempotencyKey: "intento-7" });

    expect(mocks.createReservation.mock.calls[0][0].data.idempotencyKey).toBe("intento-7");
  });

  it("si dos reintentos chocan en el índice único, devuelve la reserva del otro", async () => {
    const ganadora = { id: "res-9", code: "ARC-3001-ZZZZZZ", totalCents: 5000000, currency: "ARS" };
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    mocks.findUniqueReservation.mockResolvedValue(ganadora);

    const devuelta = await createAirportReservation({ ...reservaDeUnTramo, idempotencyKey: "intento-carrera" });

    expect(devuelta).toBe(ganadora);
  });
});

describe("ida y vuelta: una clave por viaje", () => {
  it("los dos tramos guardan la clave con el sufijo de su sentido", async () => {
    await createAirportRoundTripReservation({ ...reservaDeIdaYVuelta, idempotencyKey: "viaje-0001" });

    const claves = mocks.createReservation.mock.calls.map((llamada: Array<{ data: { idempotencyKey: string | null } }>) => llamada[0].data.idempotencyKey);
    expect(claves).toEqual(["viaje-0001:arrival", "viaje-0001:departure"]);
  });

  it("el reintento devuelve los dos tramos que ya existen, sin crear un segundo viaje", async () => {
    mocks.findManyReservations.mockResolvedValue([
      { id: "res-arr", roundTripId: "viaje-rt", airportDetails: { direction: "ARRIVAL" } },
      { id: "res-dep", roundTripId: "viaje-rt", airportDetails: { direction: "DEPARTURE" } }
    ]);

    const viaje = await createAirportRoundTripReservation({ ...reservaDeIdaYVuelta, idempotencyKey: "viaje-0002" });

    expect(viaje.roundTripId).toBe("viaje-rt");
    expect(viaje.arrival.id).toBe("res-arr");
    expect(viaje.departure.id).toBe("res-dep");
    expect(mocks.findManyReservations).toHaveBeenCalledWith(
      expect.objectContaining({ where: { idempotencyKey: { in: ["viaje-0002:arrival", "viaje-0002:departure"] } } })
    );
    expect(mocks.createReservation).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("si falta uno de los dos tramos, el alta sigue y crea el viaje (no devuelve medio viaje)", async () => {
    mocks.findManyReservations.mockResolvedValue([{ id: "res-arr", roundTripId: "viaje-rt", airportDetails: { direction: "ARRIVAL" } }]);

    await createAirportRoundTripReservation({ ...reservaDeIdaYVuelta, idempotencyKey: "viaje-0003" });

    expect(mocks.createReservation).toHaveBeenCalledTimes(2);
  });
});
