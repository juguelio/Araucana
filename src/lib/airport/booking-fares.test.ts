import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La reserva de aeropuerto graba la ruta canónica del sentido del vuelo: `routeId`, tarifa y moneda
 * tienen que salir de esa misma ruta. Antes el ID salía de la ruta del sentido y el precio de la del
 * slug, así que una reserva podía quedar con la tarifa del otro sentido. Sin ruta activa para el
 * sentido, se rechaza en vez de registrar el viaje con la ruta equivocada.
 */

const mocks = {
  findUniqueRoute: vi.fn(),
  findManyFlights: vi.fn(),
  findFirstRoute: vi.fn(),
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
  phone: "+542942000000",
  documentType: "DNI",
  documentId: "30111222",
  nationality: "Argentina"
};

const reserva = (extra: Record<string, unknown> = {}) =>
  createAirportReservation({
    routeSlug: "aeropuerto-chapelco-sma",
    flightNumber: "AR1656",
    direction: "ARRIVAL",
    serviceDate: "2030-01-01",
    passengerCount: 2,
    passenger: pasajero,
    ...extra
  } as Parameters<typeof createAirportReservation>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  // La ruta de la página (slug): 25.000 por persona.
  mocks.findUniqueRoute.mockResolvedValue({
    id: "ruta-slug",
    slug: "aeropuerto-chapelco-sma",
    isActive: true,
    bookingMode: "AIRPORT",
    priceCents: 2500000,
    currency: "ARS"
  });
  mocks.findManyFlights.mockResolvedValue([
    {
      id: "vuelo-1",
      number: "AR1656",
      direction: "ARRIVAL",
      status: "SCHEDULED",
      scheduledAt: new Date("2030-01-01T18:45:00Z"),
      estimatedAt: null,
      reservations: [],
      assignments: []
    }
  ]);
  // La ruta canónica del sentido: 40.000 por persona.
  mocks.findFirstRoute.mockResolvedValue({ id: "ruta-arrival", priceCents: 4000000, currency: "ARS" });
  mocks.createPassenger.mockResolvedValue({ id: "pax-1" });
  mocks.createReservation.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: "res-1",
    code: "ARC-3001-ABCDEF",
    totalCents: args.data.totalCents,
    currency: args.data.currency
  }));
  mocks.createPayment.mockResolvedValue({ id: "pago-1" });
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

describe("reserva de aeropuerto: ruta y tarifa del mismo sentido", () => {
  it("cobra la tarifa de la ruta canónica, no la del slug de la página", async () => {
    const creada = await reserva();

    const data = mocks.createReservation.mock.calls[0][0].data;
    expect(data.routeId).toBe("ruta-arrival");
    expect(data.totalCents).toBe(8000000); // 2 pasajeros × 40.000, no 2 × 25.000
    expect(data.currency).toBe("ARS");
    expect(creada.totalCents).toBe(8000000);

    const pago = mocks.createPayment.mock.calls[0][0].data;
    expect(pago.amountCents).toBe(8000000);
  });

  it("cobra media tarifa al menor y conserva su lugar en el cupo", async () => {
    await reserva({ halfFareCount: 1 });
    expect(mocks.createReservation.mock.calls[0][0].data).toMatchObject({
      passengerCount: 2,
      totalCents: 6000000,
      airportDetails: { create: { halfFareCount: 1 } }
    });
    expect(mocks.createPayment.mock.calls[0][0].data.amountCents).toBe(6000000);
  });

  it("rechaza más menores con media tarifa que lugares reservados", async () => {
    await expect(reserva({ halfFareCount: 3 })).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["halfFareCount"] })]
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("busca la ruta canónica con un orden estable", async () => {
    await reserva();
    expect(mocks.findFirstRoute.mock.calls[0][0]).toEqual({
      where: { bookingMode: "AIRPORT", specialType: "ARRIVAL", isActive: true },
      orderBy: { createdAt: "asc" }
    });
  });

  it("sin ruta activa para ese sentido rechaza la reserva en vez de usar la del otro sentido", async () => {
    mocks.findFirstRoute.mockResolvedValue(null);

    await expect(reserva()).rejects.toMatchObject({ code: "ROUTE_NOT_FOUND" });
    expect(mocks.createReservation).not.toHaveBeenCalled();
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });

  it("un vuelo demorado con horario estimado futuro todavía se puede reservar", async () => {
    mocks.findManyFlights.mockResolvedValue([
      {
        id: "vuelo-2",
        number: "AR1656",
        direction: "ARRIVAL",
        status: "DELAYED",
        scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
        estimatedAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        reservations: [],
        assignments: []
      }
    ]);

    await expect(reserva()).resolves.toMatchObject({ id: "res-1" });
    expect(mocks.createReservation).toHaveBeenCalledTimes(1);
  });
});
