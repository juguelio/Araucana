import { describe, expect, it } from "vitest";
import { scheduleSeatCount, scheduleSeatPool, scheduleVehicles } from "./schedule-units";
import { firstAvailableSeat } from "./repository";

const seat = (vehicleId: string, number: string, row: number, column = 1) => ({ id: `${vehicleId}-${number}`, vehicleId, number, row, column });
const combi = { id: "v1", name: "Combi 243", isActive: true, seats: [seat("v1", "1", 1), seat("v1", "2", 1, 2)] };
const sprinter = { id: "v2", name: "Sprinter 196", isActive: true, seats: [seat("v2", "1", 1), seat("v2", "2", 1, 2), seat("v2", "3", 2)] };

describe("varias naves por salida", () => {
  it("una salida pendiente no aporta cupo ni asientos para vender", () => {
    const pending = { vehicle: null };
    expect(scheduleVehicles(pending)).toEqual([]);
    expect(scheduleSeatCount(pending)).toBe(0);
    expect(scheduleSeatPool(pending)).toEqual([]);
  });

  it("el cupo es la suma de los asientos de todas las naves activas", () => {
    expect(scheduleSeatCount({ vehicle: combi })).toBe(2);
    expect(scheduleSeatCount({ vehicle: combi, extraUnits: [{ vehicle: sprinter }] })).toBe(5);
    expect(scheduleSeatCount({ vehicle: { _count: { seats: 19 } }, extraUnits: [{ vehicle: { _count: { seats: 15 } } }] })).toBe(34);
    // Una nave sumada dada de baja no suma lugares.
    expect(scheduleSeatCount({ vehicle: combi, extraUnits: [{ vehicle: { ...sprinter, isActive: false } }] })).toBe(2);
  });

  it("los asientos de la segunda nave en adelante no chocan con los de la principal", () => {
    const pool = scheduleSeatPool({ vehicle: combi, extraUnits: [{ vehicle: sprinter }] });
    expect(pool.map((item) => item.number)).toEqual(["1", "2", "U2-1", "U2-2", "U2-3"]);
    expect(new Set(pool.map((item) => item.number)).size).toBe(pool.length);
    // El id sigue siendo el del asiento real de cada nave.
    expect(pool[2]).toMatchObject({ id: "v2-1", vehicleId: "v2", unit: 2 });
  });

  it("el lugar libre se toma nave por nave: primero se llena la principal", () => {
    const pool = scheduleSeatPool({ vehicle: combi, extraUnits: [{ vehicle: sprinter }] });
    expect(firstAvailableSeat(pool, new Set(), new Set())?.number).toBe("1");
    expect(firstAvailableSeat(pool, new Set(), new Set(["1", "2"]))?.number).toBe("U2-1");
    expect(firstAvailableSeat(pool, new Set(), new Set(pool.map((item) => item.number)))).toBeNull();
  });

  it("las naves de la salida van en orden: la principal y después las sumadas", () => {
    expect(scheduleVehicles({ vehicle: combi, extraUnits: [{ vehicle: sprinter }] }).map((vehicle) => vehicle.name)).toEqual(["Combi 243", "Sprinter 196"]);
  });
});
