import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Vuelo privado cargado por el pasajero: el servidor decide si reutiliza el vuelo que ya cargó otro
 * pasajero del mismo avión o si crea uno nuevo marcado como `PASAJERO` (sin verificar). Lo que se
 * fija acá es que nunca se inventa un vuelo en otra fecha ni en el pasado, y que el cupo se comparte.
 */

const mocks = {
  findUniqueRoute: vi.fn(),
  findManyFlights: vi.fn(),
  findFirstRoute: vi.fn(),
  createFlight: vi.fn(),
  createPassenger: vi.fn(),
  createReservation: vi.fn(),
  createPayment: vi.fn(),
  transaction: vi.fn()
};

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    travelRoute: { findUnique: (...a: unknown[]) => mocks.findUniqueRoute(...a) },
    $transaction: (...a: unknown[]) => mocks.transaction(...a)
  }
}));

const { createAirportReservation } = await import("./booking");

const pasajero = {
  firstName: "Ana",
  lastName: "Gomez",
  email: "ana@example.com",
  phone: "+5492944001222",
  documentType: "DNI",
  documentId: "30111222",
  nationality: "Argentina"
};

const pedido = {
  routeSlug: "aeropuerto-chapelco-sma",
  flightNumber: "LV-BET",
  direction: "ARRIVAL" as const,
  serviceDate: "2030-01-01",
  passengerCount: 2,
  passenger: pasajero,
  privateFlight: { number: "LV-BET", scheduledAt: "2030-01-01T14:30:00-03:00" }
};

const vueloPrivadoCreado = {
  id: "vuelo-privado",
  number: "LV-BET",
  direction: "ARRIVAL",
  status: "SCHEDULED",
  scheduledAt: new Date("2030-01-01T17:30:00Z"),
  reservations: [],
  assignments: []
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUniqueRoute.mockResolvedValue({
    id: "ruta-1",
    slug: "aeropuerto-chapelco-sma",
    isActive: true,
    bookingMode: "AIRPORT",
    priceCents: 2500000,
    currency: "ARS"
  });
  mocks.findManyFlights.mockResolvedValue([]);
  mocks.findFirstRoute.mockResolvedValue({ id: "ruta-1" });
  mocks.createFlight.mockResolvedValue(vueloPrivadoCreado);
  mocks.createPassenger.mockResolvedValue({ id: "pax-1" });
  mocks.createReservation.mockResolvedValue({ id: "res-1", code: "ARC-3001-ABCDEF", totalCents: 5000000, currency: "ARS" });
  mocks.createPayment.mockResolvedValue({ id: "pago-1" });
  mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      flight: {
        findMany: (...a: unknown[]) => mocks.findManyFlights(...a),
        create: (...a: unknown[]) => mocks.createFlight(...a)
      },
      travelRoute: { findFirst: (...a: unknown[]) => mocks.findFirstRoute(...a) },
      passenger: { create: (...a: unknown[]) => mocks.createPassenger(...a) },
      reservation: { create: (...a: unknown[]) => mocks.createReservation(...a) },
      payment: { create: (...a: unknown[]) => mocks.createPayment(...a) }
    })
  );
});

describe("reserva de aeropuerto con vuelo privado", () => {
  it("crea el vuelo marcado como cargado por el pasajero y la reserva queda atada a él", async () => {
    await createAirportReservation(pedido);

    expect(mocks.createFlight).toHaveBeenCalledTimes(1);
    const vuelo = mocks.createFlight.mock.calls[0][0].data;
    expect(vuelo.number).toBe("LV-BET");
    expect(vuelo.source).toBe("PASAJERO");
    expect(vuelo.direction).toBe("ARRIVAL");
    expect(vuelo.origin).toBe("Vuelo privado");
    expect(vuelo.notes).toMatch(/pasajero/i);
    expect(vuelo.scheduledAt.toISOString()).toBe("2030-01-01T17:30:00.000Z");

    const reserva = mocks.createReservation.mock.calls[0][0].data;
    expect(reserva.airportDetails.create.flightId).toBe("vuelo-privado");
    expect(reserva.airportDetails.create.flightNumber).toBe("LV-BET");
    expect(mocks.createPayment).toHaveBeenCalledTimes(1);
  });

  it("respeta la aerolínea y el origen cuando el pasajero los carga", async () => {
    await createAirportReservation({
      ...pedido,
      privateFlight: { number: "lv-bet", airline: "Fly Patagonia", origin: "Buenos Aires", scheduledAt: "2030-01-01T14:30:00-03:00" }
    });

    const vuelo = mocks.createFlight.mock.calls[0][0].data;
    expect(vuelo.number).toBe("LV-BET");
    expect(vuelo.airline).toBe("Fly Patagonia");
    expect(vuelo.origin).toBe("Buenos Aires");
  });

  it("reutiliza el vuelo del mismo avión si otro pasajero del charter ya lo cargó", async () => {
    // 1ª búsqueda (por número exacto): sin resultados. 2ª (mismo sentido y día): el vuelo ya cargado.
    mocks.findManyFlights
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { ...vueloPrivadoCreado, number: "LV BET", id: "vuelo-de-otro-pasajero", scheduledAt: new Date("2030-01-01T13:00:00Z") }
      ]);

    await createAirportReservation(pedido);

    expect(mocks.createFlight).not.toHaveBeenCalled();
    expect(mocks.createReservation.mock.calls[0][0].data.airportDetails.create.flightId).toBe("vuelo-de-otro-pasajero");
  });

  it("no inventa un vuelo privado en otro día", async () => {
    await expect(
      createAirportReservation({ ...pedido, privateFlight: { number: "LV-BET", scheduledAt: "2030-01-02T14:30:00-03:00" } })
    ).rejects.toMatchObject({ code: "PRIVATE_FLIGHT_INVALID" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("no acepta un vuelo privado con horario ya pasado", async () => {
    await expect(
      createAirportReservation({
        ...pedido,
        serviceDate: "2020-01-01",
        privateFlight: { number: "LV-BET", scheduledAt: "2020-01-01T10:00:00-03:00" }
      })
    ).rejects.toMatchObject({ code: "FLIGHT_IN_PAST" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("sin vuelo privado sigue exigiendo que el vuelo exista en la lista", async () => {
    const { privateFlight: _omitido, ...sinPrivado } = pedido;
    await expect(createAirportReservation(sinPrivado)).rejects.toMatchObject({ code: "FLIGHT_NOT_FOUND" });
    expect(mocks.createFlight).not.toHaveBeenCalled();
  });
});
