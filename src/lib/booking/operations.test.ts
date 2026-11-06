import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminReservationWhere } from "./admin-filters";

/**
 * El panel tiene que mostrar el mismo número que aparece al hacer click en la lista filtrada: por
 * eso las colas usan `adminReservationWhere`. Y la ocupación de una salida no cuenta reservas
 * canceladas, porque si no el panel manda una combi llena cuando hay lugar de sobra.
 */

const mocks = {
  countReservations: vi.fn(),
  findManyReservations: vi.fn(),
  findManySchedules: vi.fn(),
  countFlights: vi.fn()
};

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    reservation: {
      count: (...a: unknown[]) => mocks.countReservations(...a),
      findMany: (...a: unknown[]) => mocks.findManyReservations(...a)
    },
    schedule: { findMany: (...a: unknown[]) => mocks.findManySchedules(...a) },
    flight: { count: (...a: unknown[]) => mocks.countFlights(...a) }
  }
}));

const { getAdminOperationsSummary } = await import("./operations");

const reserva = (code: string, uploadedAt: Date | null = new Date("2026-11-06T12:00:00Z")) => ({
  code,
  passenger: { firstName: "Ana", lastName: "Pérez" },
  totalCents: 1_890_000,
  currency: "ARS",
  payment: { receiptUploadedAt: uploadedAt, updatedAt: new Date("2026-11-06T12:05:00Z") }
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.countReservations.mockResolvedValue(0);
  mocks.findManyReservations.mockResolvedValue([]);
  mocks.findManySchedules.mockResolvedValue([]);
  mocks.countFlights.mockResolvedValue(0);
});

describe("resumen operativo del panel", () => {
  it("cuenta las colas con el mismo where que el listado de reservas", async () => {
    mocks.countReservations.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    const resumen = await getAdminOperationsSummary(new Date("2026-11-06T12:00:00Z"));

    expect(resumen.receiptsPending.count).toBe(3);
    expect(resumen.receiptsRejected.count).toBe(1);
    const wheres = mocks.countReservations.mock.calls.map(([args]) => args.where);
    expect(wheres[0]).toEqual(adminReservationWhere({ payment: "receipt-pending" }));
    expect(wheres[1]).toEqual(adminReservationWhere({ payment: "rejected" }));
  });

  it("arma las filas de comprobante con pasajero, monto y fecha de subida", async () => {
    mocks.findManyReservations.mockResolvedValueOnce([reserva("ARC-A")]).mockResolvedValueOnce([]);

    const resumen = await getAdminOperationsSummary();

    expect(resumen.receiptsPending.items).toEqual([
      {
        code: "ARC-A",
        passenger: "Ana Pérez",
        amountCents: 1_890_000,
        currency: "ARS",
        uploadedAt: new Date("2026-11-06T12:00:00Z")
      }
    ]);
    // La cola trae una muestra corta, ordenada por el comprobante más viejo.
    const [primera] = mocks.findManyReservations.mock.calls;
    expect(primera[0].take).toBe(4);
    expect(primera[0].orderBy[0]).toEqual({ payment: { receiptUploadedAt: "asc" } });
  });

  it("cuenta los pasajeros de una salida sin incluir las reservas canceladas", async () => {
    mocks.findManySchedules.mockResolvedValueOnce([
      {
        id: "s1",
        departureAt: new Date("2026-11-07T12:00:00Z"),
        route: { from: "San Martín de los Andes", to: "Bariloche" },
        vehicle: { name: "Araucana 24", _count: { seats: 24 } },
        reservations: [
          { passengerCount: 3, status: "CONFIRMED" },
          { passengerCount: 2, status: "PENDING_PAYMENT" },
          { passengerCount: 9, status: "CANCELLED" }
        ]
      }
    ]);

    const resumen = await getAdminOperationsSummary(new Date("2026-11-06T12:00:00Z"));

    expect(resumen.upcomingDepartures).toEqual([
      {
        id: "s1",
        routeLabel: "San Martín de los Andes → Bariloche",
        departureAt: new Date("2026-11-07T12:00:00Z"),
        occupied: 5,
        capacity: 24,
        vehicle: "Araucana 24"
      }
    ]);
  });

  it("cuenta vuelos con reservas y sin unidad, y salidas sólo del futuro", async () => {
    mocks.countFlights.mockResolvedValueOnce(2);
    const ahora = new Date("2026-11-06T12:00:00Z");

    const resumen = await getAdminOperationsSummary(ahora);

    expect(resumen.flightsWithoutVehicle).toBe(2);
    expect(resumen.receiptsPending.items).toEqual([]);
    expect(mocks.findManySchedules.mock.calls[0][0].where).toEqual({
      departureAt: { gte: ahora },
      status: { in: ["OPEN", "DOCUMENTATION"] }
    });
    expect(mocks.countFlights.mock.calls[0][0].where).toEqual({
      scheduledAt: { gte: ahora },
      assignments: { none: {} },
      reservations: { some: { reservation: { status: { not: "CANCELLED" } } } }
    });
  });
});
