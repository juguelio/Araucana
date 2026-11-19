import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceOrderReservationInput, ServiceOrderVehicle } from "@/lib/airport/service-order";

const mocks = vi.hoisted(() => ({
  reservations: vi.fn(),
  findDetails: vi.fn(),
  updateDetail: vi.fn(),
  findAssignment: vi.fn(),
  findAssignments: vi.fn(),
  findFlight: vi.fn()
}));

vi.mock("@/lib/auth/admin", () => ({ getCurrentReservationsUserOrRedirect: vi.fn(async () => ({ id: "secre", role: "SECRETARY" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit/entity", () => ({ recordEntityAuditAfterCommit: vi.fn() }));
vi.mock("@/lib/airport/service-order-repository", () => ({ getAirportServiceOrderReservations: mocks.reservations }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    airportReservationDetails: { findMany: mocks.findDetails, update: mocks.updateDetail, updateMany: vi.fn() },
    airportVehicleAssignment: { findFirst: mocks.findAssignment, findMany: mocks.findAssignments },
    flight: { findUnique: mocks.findFlight },
    $transaction: (operaciones: Array<Promise<unknown>>) => Promise.all(operaciones)
  }
}));

import { moverANaveAction } from "./actions";

const trafic = (flight: string, numero: 1 | 2): ServiceOrderVehicle => ({
  assignmentId: `t${numero}-${flight}`, vehicleId: `trafic-${numero}`, name: `Trafic ${numero}`, seats: 8, driver: null
});

function reserva(code: string, flight: "ar" | "ja", vehicles: ServiceOrderVehicle[], assignmentId: string | null = null): ServiceOrderReservationInput {
  return {
    code, totalCents: 1000, currency: "ARS", passengerCount: 2, paymentStatus: "PAID", direction: "DEPARTURE", flightNumber: flight.toUpperCase(),
    pickupName: null, pickupAddress: null, pickupNotes: null, pickupLatitude: -40.157, pickupLongitude: -71.353, assignmentId,
    passenger: { firstName: code, lastName: "Paz", phone: "1", documentType: "DNI", documentId: "1" },
    flight: {
      id: `f-${flight}`, number: flight.toUpperCase(), airline: null, direction: "DEPARTURE",
      scheduledAt: new Date(flight === "ar" ? "2026-11-20T14:00:00-03:00" : "2026-11-20T14:40:00-03:00"),
      estimatedAt: null, pickupStartOverrideAt: null, pickupGroupId: "g1", vehicles
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Cada vuelo trajo su trafic y después se juntaron: el AR tiene sólo la 1, el JA sólo la 2.
  mocks.reservations.mockResolvedValue([
    reserva("A1", "ar", [trafic("ar", 1)]),
    reserva("J1", "ja", [trafic("ja", 2)])
  ]);
  mocks.findDetails.mockImplementation(async ({ where }: { where: { reservation: { code: { in: string[] } } } }) =>
    where.reservation.code.in.map((code) => ({
      id: `det-${code}`, flightId: code.startsWith("A") ? "f-ar" : "f-ja", assignmentId: null, routePosition: null, reservation: { code }
    })));
  mocks.findFlight.mockResolvedValue({ number: "AR", scheduledAt: new Date("2026-11-20T14:00:00-03:00") });
});

describe("mover un pasajero de trafic en una recorrida unida", () => {
  it("guarda la trafic de la vuelta aunque el vuelo del pasajero no la tenga, sin crear una asignación nueva", async () => {
    mocks.findAssignment.mockResolvedValue({ vehicleId: "trafic-1", vehicle: { name: "Trafic 1" } });
    mocks.findAssignments.mockResolvedValue([{ id: "t1-ar", flightId: "f-ar" }]);

    const resultado = await moverANaveAction({ date: "2026-11-20", flightId: "f-ar", assignmentId: "t1-ar", code: "J1" });

    expect(resultado).toEqual({ ok: "Recorrida guardada." });
    expect(mocks.findAssignment).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "t1-ar", flightId: { in: ["f-ar", "f-ja"] } } }));
    expect(mocks.updateDetail).toHaveBeenCalledWith({ where: { id: "det-J1" }, data: { routePosition: expect.any(Number), assignmentId: "t1-ar" } });
  });

  it("si el vuelo del pasajero tiene esa trafic, guarda la asignación de su propio vuelo", async () => {
    mocks.findAssignment.mockResolvedValue({ vehicleId: "trafic-1", vehicle: { name: "Trafic 1" } });
    mocks.findAssignments.mockResolvedValue([{ id: "t1-ar", flightId: "f-ar" }, { id: "t1-ja", flightId: "f-ja" }]);

    await moverANaveAction({ date: "2026-11-20", flightId: "f-ar", assignmentId: "t1-ar", code: "J1" });

    expect(mocks.updateDetail).toHaveBeenCalledWith({ where: { id: "det-J1" }, data: { routePosition: expect.any(Number), assignmentId: "t1-ja" } });
    expect(mocks.updateDetail).toHaveBeenCalledWith({ where: { id: "det-A1" }, data: { routePosition: expect.any(Number), assignmentId: "t1-ar" } });
  });
});
