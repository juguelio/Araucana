import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { driverConflicts } from "./conflicts";

const at = (time: string, day = "2026-11-20") => new Date(`${day}T${time}:00-03:00`);

function tx(rows: { schedules?: unknown[]; units?: unknown[]; special?: unknown[]; chapelco?: unknown[]; airport?: unknown[] } = {}) {
  const calls = {
    schedule: vi.fn(async (_args: unknown) => rows.schedules ?? []),
    scheduleUnit: vi.fn(async (_args: unknown) => rows.units ?? []),
    specialTripAssignment: vi.fn(async (_args: unknown) => rows.special ?? []),
    chapelcoVehicleDuty: vi.fn(async (_args: unknown) => rows.chapelco ?? []),
    airportVehicleAssignment: vi.fn(async (_args: unknown) => rows.airport ?? [])
  };
  const client = {
    schedule: { findMany: calls.schedule },
    scheduleUnit: { findMany: calls.scheduleUnit },
    specialTripAssignment: { findMany: calls.specialTripAssignment },
    chapelcoVehicleDuty: { findMany: calls.chapelcoVehicleDuty },
    airportVehicleAssignment: { findMany: calls.airportVehicleAssignment }
  } as unknown as Prisma.TransactionClient;
  return { client, calls };
}

const tramo = { driverId: "d1", startsAt: at("11:30"), endsAt: at("14:00") };

describe("driverConflicts: dónde más maneja el chofer en ese tramo", () => {
  it("busca al chofer en salidas de ruta, naves sumadas, viajes especiales, Chapelco y otros vuelos", async () => {
    const { client, calls } = tx();
    expect(await driverConflicts(client, tramo, { flightId: "f1", vehicleId: "v1" })).toEqual([]);
    const overlap = { departureAt: { lt: tramo.endsAt }, arrivalAt: { gt: tramo.startsAt }, status: { notIn: ["CANCELLED", "CANCELED", "CLOSED"] } };
    expect(calls.schedule).toHaveBeenCalledWith(expect.objectContaining({ where: { driverId: "d1", ...overlap } }));
    expect(calls.scheduleUnit).toHaveBeenCalledWith(expect.objectContaining({ where: { driverId: "d1", schedule: overlap } }));
    expect(calls.specialTripAssignment).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ driverId: "d1" }, { coDriverId: "d1" }], startsAt: { lt: tramo.endsAt }, endsAt: { gt: tramo.startsAt } })
    }));
    expect(calls.chapelcoVehicleDuty).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ driverId: "d1", status: "ACTIVE" }) }));
    // La combi que se está guardando no choca consigo misma; las otras combis del mismo vuelo sí cuentan.
    expect(calls.airportVehicleAssignment).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ driverId: "d1", NOT: { flightId: "f1", vehicleId: "v1" } }) }));
  });

  it("marca como del chofer cada cruce y sólo cuenta los vuelos cuya ventana se superpone", async () => {
    const { client } = tx({
      schedules: [{ id: "s1", routeId: "r1", route: { from: "SMA", to: "Villa Traful" } }],
      units: [{ id: "u1", scheduleId: "s2", schedule: { routeId: "r2", route: { from: "SMA", to: "Bariloche" } } }],
      special: [{ id: "e1", tripId: "t1", trip: { client: "Hotel Llao" } }],
      chapelco: [{ id: "c1", operationDay: { serviceDate: new Date("2026-11-20T00:00:00Z") } }],
      airport: [
        // Arribo 13:00 → ocupa 12:30–15:00: se cruza.
        { id: "a1", flightId: "f2", flight: { number: "AR 1656", direction: "ARRIVAL", scheduledAt: at("13:00"), estimatedAt: null, pickupStartOverrideAt: null, status: "SCHEDULED" } },
        // Arribo 20:00 → ocupa 19:30–22:00: no se cruza.
        { id: "a2", flightId: "f3", flight: { number: "AR 1660", direction: "ARRIVAL", scheduledAt: at("20:00"), estimatedAt: null, pickupStartOverrideAt: null, status: "SCHEDULED" } }
      ]
    });
    const conflicts = await driverConflicts(client, tramo, { flightId: "f1", vehicleId: "v1" });
    expect(conflicts.map((c) => [c.id, c.label, c.possible, c.subject])).toEqual([
      ["chofer:s1", "Chofer · Servicio público · SMA → Villa Traful", false, "driver"],
      ["chofer:u1", "Chofer · Servicio público · SMA → Bariloche", false, "driver"],
      ["chofer:e1", "Chofer · Viajes especiales · Hotel Llao", false, "driver"],
      ["chofer:c1", "Chofer · Chapelco", true, "driver"],
      ["chofer:a1", "Chofer · Aeropuerto · AR 1656", true, "driver"]
    ]);
    expect(conflicts[4].href).toBe("/admin/aeropuerto?date=2026-11-20#vuelo-f2");
  });
});
