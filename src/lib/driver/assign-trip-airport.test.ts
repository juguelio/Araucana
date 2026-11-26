import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assignAirportTrip, listPendingAirportTrips } from "./assign-trip-airport";

const mocks = vi.hoisted(() => ({ flights: vi.fn(), save: vi.fn(), conflicts: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { flight: { findMany: mocks.flights } } }));
vi.mock("@/lib/airport/fleet-assignment", () => ({ saveAirportFleet: mocks.save }));
vi.mock("@/lib/special-trips/conflicts", () => ({ fleetConflicts: mocks.conflicts, driverConflicts: mocks.conflicts }));
vi.mock("./school-trip-conflicts", () => ({ schoolTripConflicts: mocks.conflicts }));

const day = "2026-11-25";
const flight = {
  id: "vuelo-1", number: "AR1650", direction: "ARRIVAL", status: "SCHEDULED", source: "MANUAL", lastCheckedAt: null,
  scheduledAt: new Date(day + "T09:00:00-03:00"), estimatedAt: null, pickupStartInitialAt: null,
  pickupStartOverrideAt: null, pickupGroupId: null, reservations: [], assignments: []
};
const privateReservation = {
  isPrivate: true, reservationId: "r1", reservation: { shortCode: "PR1", passengerCount: 6 }
};
const tx = { flight: { findMany: mocks.flights } } as unknown as Prisma.TransactionClient;
const request = {
  kind: "airport" as const, id: "vuelo-1", day, driverId: "chofer", vehicleId: "nave",
  actor: { id: "admin", role: "ADMIN" }, confirmation: ""
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.conflicts.mockResolvedValue([]);
});

describe("asignación de traslados de aeropuerto desde Choferes", () => {
  it("muestra una sola recorrida por grupo y un traslado por cada reserva privada pendiente", async () => {
    mocks.flights.mockResolvedValue([
      { ...flight, pickupGroupId: "grupo", reservations: [privateReservation] },
      { ...flight, pickupGroupId: "grupo", id: "vuelo-2", number: "JA3184",
        reservations: [{ ...privateReservation, isPrivate: false }] }
    ]);
    const trips = await listPendingAirportTrips(day);
    expect(trips.map(t => [t.kind, t.id, t.title])).toEqual([
      ["private", "r1", "AR1650 · PR1"], ["airport", "grupo", "AR1650 + JA3184"]
    ]);
  });

  it("oculta la recorrida si algún vuelo del grupo tiene nave y conserva un privado pendiente", async () => {
    mocks.flights.mockResolvedValue([
      { ...flight, pickupGroupId: "grupo", reservations: [privateReservation] },
      { ...flight, id: "vuelo-2", pickupGroupId: "grupo", assignments: [{ privateReservationId: null }] },
      { ...flight, id: "cancelado", status: "CANCELLED" }, { ...flight, id: "fantasma", source: "ESTIMADO" }
    ]);
    expect((await listPendingAirportTrips(day)).map(t => t.id)).toEqual(["r1"]);
  });

  it("ubica la recogida de madrugada en el día en que sale la nave", async () => {
    mocks.flights.mockResolvedValue([{ ...flight, direction: "DEPARTURE", scheduledAt: new Date("2026-11-26T01:00:00-03:00") }]);
    const [trip] = await listPendingAirportTrips(day);
    expect(trip.startsAt).toEqual(+new Date("2026-11-25T22:30:00-03:00"));
    expect(await listPendingAirportTrips("2026-11-26")).toEqual([]);
  });

  it("conserva los clientes de un vuelo por revisar y los de una proyección histórica", async () => {
    mocks.flights.mockResolvedValue([
      { ...flight, source: "REVISAR", reservations: [{ ...privateReservation, isPrivate: false }] },
      { ...flight, id: "antiguo", source: "ESTIMADO", reservations: [privateReservation] }
    ]);
    expect(await listPendingAirportTrips(day)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "vuelo-1", detail: expect.stringContaining("Revisar vuelo · 6 pax") }),
      expect.objectContaining({ id: "r1", kind: "private" })
    ]));
  });

  it("lista todos los días futuros en una lectura y usa el día operativo de cada traslado", async () => {
    const future = "2027-04-06";
    mocks.flights.mockResolvedValue([
      { ...flight, id: "pasado", scheduledAt: new Date("2026-11-24T12:00:00-03:00") },
      flight,
      { ...flight, id: "futuro", scheduledAt: new Date(future + "T01:15:00-03:00"), direction: "DEPARTURE", reservations: [privateReservation] },
      { ...flight, id: "futuro-compartido", scheduledAt: new Date(future + "T12:00:00-03:00") }
    ]);
    const trips = await listPendingAirportTrips(day, true);
    expect(trips.map(t => [t.id, t.day])).toEqual([
      ["r1", "2027-04-05"], ["vuelo-1", day], ["futuro-compartido", future]
    ]);
    expect(mocks.flights).toHaveBeenCalledTimes(1);
    for (const condition of mocks.flights.mock.calls[0][0].where.OR as Record<string, { lt?: Date }>[]) {
      expect(Object.values(condition)[0].lt).toBeUndefined();
    }
  });

  it("al guardar un viaje futuro sigue validando el día operativo seleccionado", async () => {
    mocks.flights.mockResolvedValue([{ ...flight, scheduledAt: new Date("2026-11-26T14:00:00-03:00") }]);
    expect(await assignAirportTrip(tx, request)).toHaveProperty("error");
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.save.mockResolvedValue({ day: "2026-11-26", message: "Guardado" });
    expect(await assignAirportTrip(tx, { ...request, day: "2026-11-26" })).toEqual({ saved: true });
  });

  it("no ofrece como libre una recorrida lejana si otro vuelo de su día programado ya tiene nave", async () => {
    const originalDay = new Date("2026-11-21T11:00:00-03:00");
    mocks.flights.mockResolvedValueOnce([{ ...flight, scheduledAt: originalDay, estimatedAt: flight.scheduledAt, pickupGroupId: "g" }])
      .mockResolvedValueOnce([{ ...flight, id: "otro", scheduledAt: originalDay, pickupGroupId: "g", assignments: [{ privateReservationId: null }] }]);
    expect(await listPendingAirportTrips(day)).toEqual([]);
    expect(mocks.flights).toHaveBeenCalledTimes(2);
  });

  it("vuelve a verificar el pendiente al guardar y conserva cualquier asignación que se adelantó", async () => {
    mocks.flights.mockResolvedValue([{ ...flight, assignments: [{ privateReservationId: null }] }]);
    expect(await assignAirportTrip(tx, request)).toHaveProperty("error");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("asigna nave y chofer a la reserva privada aunque el vuelo compartido ya tenga nave", async () => {
    mocks.flights.mockResolvedValue([{ ...flight, reservations: [privateReservation], assignments: [{ privateReservationId: null }] }]);
    mocks.save.mockResolvedValue({ day, message: "Guardado" });
    expect(await assignAirportTrip(tx, { ...request, kind: "private", id: "r1" })).toEqual({ saved: true });
    expect(mocks.save).toHaveBeenCalledWith(tx, request.actor, expect.objectContaining({
      privateReservationId: "r1", flightId: "vuelo-1", driverId: "chofer", vehicleId: "nave", pendingFlights: [expect.objectContaining({ id: "vuelo-1" })]
    }));
  });
});
