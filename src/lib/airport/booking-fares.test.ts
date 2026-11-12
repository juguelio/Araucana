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

const settings = vi.hoisted(() => ({
  extras: { zoneExtraCents: 0, sportsLuggageCents: 0, arrivalCutoffMinutes: 0 },
  coverage: { enabled: false, boundary: [] as Array<[number, number]>, exclusions: [] as Array<Array<[number, number]>>, extraBoundary: [] as Array<[number, number]> }
}));
vi.mock("./extras-settings", () => ({ getAirportExtras: async () => settings.extras }));
vi.mock("./pickup-zone-settings", () => ({ getAirportCoverage: async () => settings.coverage }));

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

const reserva = (extra: Record<string, unknown> = {}, fromAdmin = false) =>
  createAirportReservation({
    routeSlug: "aeropuerto-chapelco-sma",
    flightNumber: "AR1656",
    direction: "ARRIVAL",
    serviceDate: "2030-01-01",
    passengerCount: 2,
    passenger: pasajero,
    ...extra
  } as Parameters<typeof createAirportReservation>[0], fromAdmin ? {
    fromAdmin: true,
    creator: { id: "admin-1", name: "Ana", email: "admin@example.com", role: "ADMIN" }
  } : {});

beforeEach(() => {
  vi.clearAllMocks();
  settings.extras = { zoneExtraCents: 0, sportsLuggageCents: 0, arrivalCutoffMinutes: 0 };
  settings.coverage = { enabled: false, boundary: [], exclusions: [], extraBoundary: [] };
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

  it("usa un total manual solo para la carga administrativa", async () => {
    await expect(reserva({ overrideTotalCents: 123456 }, true)).resolves.toMatchObject({ totalCents: 123456 });
    expect(mocks.createPayment.mock.calls[0][0].data.amountCents).toBe(123456);
    await expect(reserva({ overrideTotalCents: 123456 })).resolves.toMatchObject({ totalCents: 8000000 });
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
      issues: expect.arrayContaining([expect.objectContaining({ path: ["halfFareCount"] })])
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

describe("reserva de aeropuerto: extras", () => {
  const verde: Array<[number, number]> = [[-40.17, -71.37], [-40.17, -71.30], [-40.13, -71.30], [-40.13, -71.37]];
  const naranja: Array<[number, number]> = [[-40.25, -71.45], [-40.25, -71.20], [-40.05, -71.20], [-40.05, -71.45]];

  beforeEach(() => {
    settings.extras = { zoneExtraCents: 500000, sportsLuggageCents: 300000, arrivalCutoffMinutes: 0 };
    settings.coverage = { enabled: true, boundary: verde, exclusions: [], extraBoundary: naranja };
  });

  it("suma el equipaje deportivo por bulto y guarda el precio vigente", async () => {
    await reserva({ sportsLuggageCount: 2, pickupPoint: [-40.15, -71.34] });
    expect(mocks.createReservation.mock.calls[0][0].data).toMatchObject({
      totalCents: 8000000 + 600000,
      airportDetails: { create: { sportsLuggageCount: 2, sportsLuggageUnitCents: 300000, zoneExtraCents: 0 } }
    });
    expect(mocks.createPayment.mock.calls[0][0].data.amountCents).toBe(8600000);
  });

  it("cobra el recargo cuando el punto cae en la zona con recargo", async () => {
    await reserva({ pickupPoint: [-40.10, -71.25] });
    expect(mocks.createReservation.mock.calls[0][0].data).toMatchObject({
      totalCents: 8000000 + 500000,
      airportDetails: { create: { zoneExtraCents: 500000 } }
    });
  });

  it("sin el mapa aplicado no cobra recargo de zona", async () => {
    settings.coverage = { ...settings.coverage, enabled: false };
    await reserva({ pickupPoint: [-40.10, -71.25] });
    expect(mocks.createReservation.mock.calls[0][0].data.totalCents).toBe(8000000);
  });

  it("el total manual del panel reemplaza también a los extras", async () => {
    await reserva({ sportsLuggageCount: 1, pickupPoint: [-40.10, -71.25], overrideTotalCents: 100000 }, true);
    expect(mocks.createReservation.mock.calls[0][0].data.totalCents).toBe(100000);
  });

  it("cierra el arribo antes de aterrizar según la configuración", async () => {
    settings.extras = { ...settings.extras, arrivalCutoffMinutes: 20 };
    vi.useFakeTimers({ now: new Date("2030-01-01T18:30:00Z"), toFake: ["Date"] });
    try {
      await expect(reserva()).rejects.toMatchObject({ code: "SCHEDULE_CLOSED" });
    } finally {
      vi.useRealTimers();
    }
  });
});
