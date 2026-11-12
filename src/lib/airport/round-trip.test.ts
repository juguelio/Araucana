import { beforeEach, describe, expect, it, vi } from "vitest";
import { airportRoundTripSchema } from "./validation";

/**
 * Ida y vuelta del aeropuerto (#36): **una sola transacción** crea los dos tramos con el pasajero
 * cargado una vez. Lo que se fija acá es que las dos reservas compartan el `roundTripId`, que cada
 * una quede atada a **su** vuelo y su dirección, que haya un pago por tramo y que un tramo sin cupo
 * no deje media reserva creada.
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

const { createAirportRoundTripReservation } = await import("./booking");

const pasajero = {
  firstName: "Ana",
  lastName: "Gomez",
  email: "ana@example.com",
  // Se arma por partes: la salida de las herramientas redacta los teléfonos y deja asteriscos.
  phone: ["+549", "2944", "123456"].join(""),
  documentType: "DNI",
  documentId: "30111222",
  nationality: "Argentina"
};

const pedido = {
  routeSlug: "aeropuerto-chapelco-sma",
  passengerCount: 2,
  halfFareCount: 1,
  freeFareCount: 0,
  passenger: pasajero,
  arrival: { flightNumber: "AR1656", serviceDate: "2030-01-01", pickupAddress: "Koessler 1686", pickupPoint: [-40.15, -71.3] as [number, number] },
  departure: { flightNumber: "AR1657", serviceDate: "2030-01-08", pickupAddress: "Roca 500", pickupPoint: [-40.16, -71.31] as [number, number] }
};

const vueloLlegada = {
  id: "vuelo-llegada",
  number: "AR1656",
  direction: "ARRIVAL",
  status: "SCHEDULED",
  scheduledAt: new Date("2030-01-01T17:30:00Z"),
  reservations: [],
  assignments: []
};

const vueloVuelta = {
  id: "vuelo-vuelta",
  number: "AR1657",
  direction: "DEPARTURE",
  status: "SCHEDULED",
  scheduledAt: new Date("2030-01-08T17:30:00Z"),
  reservations: [],
  assignments: []
};

function crearTx() {
  return {
    flight: {
      findMany: (...a: unknown[]) => mocks.findManyFlights(...a),
      create: vi.fn()
    },
    travelRoute: { findFirst: (...a: unknown[]) => mocks.findFirstRoute(...a) },
    passenger: { create: (...a: unknown[]) => mocks.createPassenger(...a) },
    reservation: { create: (...a: unknown[]) => mocks.createReservation(...a) },
    payment: { create: (...a: unknown[]) => mocks.createPayment(...a) }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUniqueRoute.mockResolvedValue({ id: "ruta-1", slug: "aeropuerto-chapelco-sma", isActive: true, bookingMode: "AIRPORT" });
  mocks.findManyFlights.mockResolvedValue([vueloLlegada, vueloVuelta]);
  mocks.findFirstRoute.mockImplementation(async ({ where }: { where: { specialType: string } }) => ({ id: `ruta-${where.specialType}`, priceCents: 1500000, currency: "ARS" }));
  mocks.createPassenger.mockResolvedValue({ id: "pax-1" });
  let numero = 0;
  mocks.createReservation.mockImplementation(async () => {
    numero += 1;
    return { id: `res-${numero}`, code: `ARC-3001-CODIGO${numero}`, shortCode: `CORTO00${numero}`, totalCents: 2250000, currency: "ARS" };
  });
  mocks.createPayment.mockResolvedValue({ id: "pago-1" });
  mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(crearTx()));
});

describe("ida y vuelta del aeropuerto", () => {
  it("crea las dos reservas con el mismo roundTripId, un solo pasajero y un pago por tramo", async () => {
    const resultado = await createAirportRoundTripReservation(pedido);

    expect(mocks.createPassenger).toHaveBeenCalledTimes(1);
    expect(mocks.createReservation).toHaveBeenCalledTimes(2);
    expect(mocks.createPayment).toHaveBeenCalledTimes(2);

    const [llegada, vuelta] = mocks.createReservation.mock.calls.map(([args]) => args.data);
    expect(llegada.roundTripId).toBe(resultado.roundTripId);
    expect(vuelta.roundTripId).toBe(resultado.roundTripId);
    expect(resultado.roundTripId).toMatch(/^[0-9a-f-]{36}$/);

    // Cada tramo con SU vuelo y SU dirección; los dos con el mismo pasajero.
    expect(llegada.airportDetails.create.flightId).toBe("vuelo-llegada");
    expect(llegada.airportDetails.create.direction).toBe("ARRIVAL");
    expect(vuelta.airportDetails.create.flightId).toBe("vuelo-vuelta");
    expect(vuelta.airportDetails.create.direction).toBe("DEPARTURE");
    expect(llegada.passengerId).toBe("pax-1");
    expect(vuelta.passengerId).toBe("pax-1");

    // Cada pickup va al tramo que corresponde.
    expect(llegada.airportDetails.create.pickupAddress).toBe("Koessler 1686");
    expect(vuelta.airportDetails.create.pickupAddress).toBe("Roca 500");

    // Códigos distintos por tramo, y la tarifa de cada sentido.
    expect(llegada.code).not.toBe(vuelta.code);
    expect(llegada.routeId).toBe("ruta-ARRIVAL");
    expect(vuelta.routeId).toBe("ruta-DEPARTURE");
    expect(llegada.shortCode).toBeTruthy();
    expect(vuelta.shortCode).toBeTruthy();
  });

  it("si la vuelta no tiene cupo el viaje no se crea: la transacción entera se cae", async () => {
    // La vuelta tiene una combi de un solo asiento y ya lleva un pasajero: disponible 0.
    mocks.findManyFlights.mockResolvedValue([
      vueloLlegada,
      { ...vueloVuelta, assignments: [{ vehicle: { seats: [{ id: "s1" }] } }], reservations: [{ reservation: { passengerCount: 1, status: "CONFIRMED" } }] }
    ]);

    await expect(createAirportRoundTripReservation(pedido)).rejects.toMatchObject({ code: "CAPACITY_FULL" });
    // La llegada se crea primero (para que el error hable de la vuelta) y la base revierte las dos.
    expect(mocks.createReservation).toHaveBeenCalledTimes(1);
    expect(mocks.createPayment).toHaveBeenCalledTimes(1);
  });

  it("la vuelta no puede ser antes de la llegada", () => {
    const invalido = { ...pedido, departure: { ...pedido.departure, serviceDate: "2029-12-31" } };
    const parsed = airportRoundTripSchema.safeParse(invalido);
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0].message).toMatch(/antes de la llegada/i);
  });

  it("acepta un ida y vuelta el mismo día", () => {
    const parsed = airportRoundTripSchema.safeParse({ ...pedido, departure: { ...pedido.departure, serviceDate: "2030-01-01" } });
    expect(parsed.success).toBe(true);
  });
});
