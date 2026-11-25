import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  schedule: { findMany: vi.fn() }, specialTripAssignment: { findMany: vi.fn() }, schoolRun: { findMany: vi.fn() },
  chapelcoVehicleDuty: { findMany: vi.fn() }, flight: { findMany: vi.fn() }
}));
const orden = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/airport/service-order-data", () => ({ getAirportServiceOrder: orden }));

import { cargarJornadaApp, cargarVentanasGpsApp } from "./jornada-app";

const dia = "2026-11-25";
const unidad = { id: "v1", name: "Nave 1", internalNumber: "24", licensePlate: "AAA", isActive: true };
const otra = { ...unidad, id: "v2", name: "Nave 2" };
const pasajero = { firstName: "Ana", lastName: "Sur", phone: "123" };

beforeEach(() => {
  vi.resetAllMocks();
  for (const modelo of Object.values(db)) modelo.findMany.mockResolvedValue([]);
});

describe("jornada del chofer", () => {
  it("consulta exclusivamente las asignaciones del chofer y las siete fechas locales", async () => {
    expect(await cargarJornadaApp("d", dia)).toEqual({ fecha: dia, servicios: [] });
    expect(db.schedule.findMany.mock.calls[0][0].where).toMatchObject({
      OR: [{ driverId: "d" }, { extraUnits: { some: { driverId: "d" } } }],
      departureAt: { lt: new Date("2026-12-02T03:00:00Z") }, arrivalAt: { gt: new Date("2026-11-25T03:00:00Z") }
    });
    expect(db.flight.findMany.mock.calls[0][0].where.assignments).toEqual({ some: { driverId: "d" } });
    expect(db.specialTripAssignment.findMany.mock.calls[0][0].where.driverId).toBe("d");
    expect(db.chapelcoVehicleDuty.findMany.mock.calls[0][0].where).toMatchObject({ driverId: "d", status: "ACTIVE" });
    expect(db.schoolRun.findMany.mock.calls[0][0].where).toEqual({
      driverId: "d", serviceDate: { gte: new Date(dia), lt: new Date("2026-12-02") }
    });
    expect(orden).not.toHaveBeenCalled();
  });

  it("presenta la nómina compartida en la nave adicional y conserva el tramo del pasajero", async () => {
    db.schedule.findMany.mockResolvedValue([{ id: "s", driverId: "otro", vehicle: otra, _count: { extraUnits: 1 },
      extraUnits: [{ vehicle: unidad }], route: { from: "A", to: "B", via: "Ruta 40", stops: [{ name: "C" }] },
      departureAt: new Date("2026-11-26T02:00:00Z"), arrivalAt: new Date("2026-11-26T04:00:00Z"),
      reservations: [{ id: "r1", passenger: pasajero, passengerCount: 3, boardingStop: "A", dropoffStop: "C" }] }]);
    const { servicios } = await cargarJornadaApp("d", dia);
    expect(servicios.map(s => s.fecha)).toEqual([dia, "2026-11-26"]);
    expect(servicios[0]).toMatchObject({ id: "salida-s", compartida: true, nave: { id: "v1", interno: "24", patente: "AAA" },
      paradas: ["A", "C", "B"], filas: [{ id: "r1", nombre: "Ana Sur", cantidad: 3, detalle: "A → C" }] });
    expect(JSON.stringify(servicios)).not.toContain("v2");
  });

  it("conserva las hojas sin nómina y ventanas incompletas sin inventar una hora de fin", async () => {
    db.chapelcoVehicleDuty.findMany.mockResolvedValue([{ operationDay: { id: "o", serviceDate: new Date(dia), route: { from: "A", to: "Cerro" } },
      vehicle: unidad, notes: null, runs: [{ id: "sub", direction: "UP", ascentSlot: "08:30", sequence: 1, stops: [{
        id: "p", pickupName: "Hotel", pickupAddress: "Calle 1", passengerCount: 2, status: "BOARDED", driverNotes: "", reservation: { passenger: pasajero }
      }] }] }]);
    db.schoolRun.findMany.mockResolvedValue([{ id: "esc", serviceDate: new Date(dia), shift: "Mañana", routeName: "Escuela", vehicle: null }]);
    const { servicios } = await cargarJornadaApp("d", dia);
    expect(servicios[0]).toMatchObject({ id: "vuelta-sub", salida: "2026-11-25T11:30:00.000Z", fin: null, filas: [{ id: "p", cantidad: 2, registroAnterior: "Subieron 2 pasajeros · Registro anterior de la vuelta" }] });
    expect(servicios[1]).toMatchObject({ id: "esc", salida: null, fin: null, nave: null, filas: [] });
    const gps = await cargarVentanasGpsApp("d", dia);
    expect(gps[0]).not.toHaveProperty("filas");
    expect(db.chapelcoVehicleDuty.findMany.mock.lastCall?.[0].select.runs.select.stops).toBe(false);
    expect(db.schedule.findMany.mock.lastCall?.[0].select.reservations).toBe(false);
    expect(db.specialTripAssignment.findMany.mock.lastCall?.[0].select.trip.select.departureSheets).toBe(false);
  });

  it("reconcilia las dos planillas del especial sin duplicar personas ni exponer sus documentos", async () => {
    const p = { id: "p", ...pasajero, documentType: "DNI", documentNumber: "9999999" };
    db.specialTripAssignment.findMany.mockResolvedValue([{ id: "a1", vehicle: unidad,
      startsAt: new Date("2026-11-24T20:00:00Z"), endsAt: new Date("2026-11-26T03:00:00Z"),
      trip: { client: "Cliente", passengers: 1, destinationSearch: "Filo", legs: [], notes: "Puerta este", _count: { assignments: 1 },
        departureSheets: [{ passengers: [p] }, { passengers: [{ ...p, id: "p2" }] }] } }]);
    const { servicios } = await cargarJornadaApp("d", dia);
    expect(servicios).toHaveLength(1);
    expect(servicios[0]).toMatchObject({ fecha: dia, id: "especial-a1", filas: [{ id: "p", nombre: "Ana Sur", cantidad: 1 }] });
    expect(JSON.stringify(servicios)).not.toContain("9999999");
  });

  it("usa la orden de la unidad del chofer, oculta el código privado y respeta el origen de Paihuén", async () => {
    const flight = { id: "f1", number: "AR1", direction: "DEPARTURE", pickupGroupId: null,
      scheduledAt: new Date("2026-11-25T15:00:00Z"), estimatedAt: null, assignments: [
        { id: "a", driverId: "d", vehicle: unidad }, { id: "b", driverId: "otro", vehicle: otra }
      ] };
    db.flight.findMany.mockResolvedValue([flight]);
    const p = { code: "SECRETO", name: "Ana Sur", seats: 2, contact: "123", lodging: "Paihuen", lodgingDetail: "", pickup: null };
    const block = { key: "f1:a", vehicle: { vehicleId: "v1", assignmentId: "a", driverId: "d" },
      flightIds: ["f1"], direction: "DEPARTURE", flightNumber: "AR1", flights: [], scheduledAt: flight.scheduledAt,
      operationAt: new Date("2026-11-25T11:00:00Z"), passengers: [p] };
    orden.mockResolvedValue({ oficina: { address: "Oficina", point: [0, 0] }, blocks: [block,
      { ...block, key: "f1:b", passengers: [{ ...p, name: "Nombre ajeno" }], vehicle: { vehicleId: "v2", assignmentId: "b", driverId: "otro" } }] });
    const { servicios } = await cargarJornadaApp("d", dia);
    expect(servicios).toHaveLength(1);
    expect(servicios[0]).toMatchObject({ id: "orden-f1:a", origen: "Paihuen", filas: [{ nombre: "Ana Sur", cantidad: 2 }] });
    expect(JSON.stringify(servicios)).not.toMatch(/SECRETO|Nombre ajeno/);
    expect(orden.mock.calls[0][2]).toMatchObject({ vuelos: ["f1"] });
  });
});
