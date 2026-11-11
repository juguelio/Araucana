import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La reserva de aeropuerto tiene que crear el pago pendiente (transferencia manual), igual que
 * las reservas comunes: sin eso, el pasajero no ve el panel para subir el comprobante y la
 * reserva nunca se puede confirmar. Este test fija ese comportamiento.
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
  mocks.findManyFlights.mockResolvedValue([
    {
      id: "vuelo-1",
      number: "AR1656",
      direction: "ARRIVAL",
      status: "SCHEDULED",
      scheduledAt: new Date("2030-01-01T18:45:00Z"),
      reservations: [],
      assignments: []
    }
  ]);
  mocks.findFirstRoute.mockResolvedValue({ id: "ruta-1" });
  mocks.createPassenger.mockResolvedValue({ id: "pax-1" });
  mocks.createReservation.mockResolvedValue({
    id: "res-1",
    code: "ARC-3001-ABCDEF",
    totalCents: 5000000,
    currency: "ARS"
  });
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

describe("reserva de aeropuerto: pago pendiente", () => {
  it("crea el pago manual pendiente con el total de la reserva", async () => {
    await createAirportReservation({
      routeSlug: "aeropuerto-chapelco-sma",
      flightNumber: "AR1656",
      direction: "ARRIVAL",
      serviceDate: "2030-01-01",
      passengerCount: 2,
      passenger: {
        firstName: "Ana",
        lastName: "Gomez",
        email: "ana@example.com",
        phone: "+542944111222",
        documentType: "DNI",
        documentId: "30111222",
        nationality: "Argentina"
      }
    });

    expect(mocks.createPayment).toHaveBeenCalledTimes(1);
    const data = mocks.createPayment.mock.calls[0][0].data;
    expect(data.reservationId).toBe("res-1");
    expect(data.provider).toBe("MANUAL");
    expect(data.status).toBe("PENDING");
    expect(data.amountCents).toBe(5000000);
    expect(data.currency).toBe("ARS");
  });
});
