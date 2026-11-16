import { describe, expect, it } from "vitest";
import { buildDayBoard, dayRange, flightRow, isDateKey, localDateKey, personName, shiftDateKey, sortBoard, type BoardRow } from "./day-board";

const at = (hm: string) => new Date(`2026-11-17T${hm}:00-03:00`);
const chofer = { id: "d1", name: "Ramón Paz", email: "ramon@ejemplo.test" };
const combi = { id: "v1", name: "Combi 243", seats: 19 };

describe("salidas del día (issue #174)", () => {
  it("junta las cuatro áreas en una lista ordenada por la hora en que sale la unidad", () => {
    const { rows } = buildDayBoard({
      dateKey: "2026-11-17",
      schedules: [{ id: "s1", routeId: "r1", from: "San Martín", to: "Villa Traful", departureAt: at("09:00"), status: "OPEN", passengers: 6, vehicle: combi, driver: null }],
      flights: [{ id: "f1", number: "AR1657", direction: "DEPARTURE", scheduledAt: at("16:45"), estimatedAt: null, pickupStart: at("13:30"), status: "SCHEDULED", passengers: 4, units: [] }],
      chapelco: [],
      specialTrips: [{ id: "t1", client: "Colegio Nacional", passengers: 40, status: "CONFIRMED", firstLegAt: at("07:00"), units: [] }]
    });
    expect(rows.map((row) => [row.area, row.atLabel])).toEqual([["ESPECIAL", "Sale"], ["RUTA", "Sale"], ["AEROPUERTO", "Recorrida"]]);
    // La partida se ordena por el inicio de la recorrida (13:30), no por el despegue (16:45).
    expect(rows[2].at).toEqual(at("13:30"));
  });

  it("marca lo que falta asignar: nave, chofer y lugares", () => {
    const { rows, summary } = buildDayBoard({
      dateKey: "2026-11-17",
      schedules: [{ id: "s1", routeId: "r1", from: "A", to: "B", departureAt: at("09:00"), status: "OPEN", passengers: 3, vehicle: combi, driver: null }],
      flights: [
        { id: "f1", number: "JA3181", direction: "ARRIVAL", scheduledAt: at("12:48"), estimatedAt: at("13:25"), pickupStart: null, status: "DELAYED", passengers: 8, units: [] },
        { id: "f2", number: "AR1656", direction: "ARRIVAL", scheduledAt: at("08:30"), estimatedAt: null, pickupStart: null, status: "SCHEDULED", passengers: 22, units: [{ id: "a1", vehicle: combi, driver: chofer }] }
      ],
      chapelco: [],
      specialTrips: []
    });
    const [vuelo830, salida, vuelo1325] = rows;
    expect(salida).toMatchObject({ missingVehicle: false, missingDriver: true, overbooked: false, capacity: 19 });
    expect(vuelo1325).toMatchObject({ missingVehicle: true, missingDriver: false, status: "Demorado", atLabel: "Aterriza" });
    expect(vuelo1325.at).toEqual(at("13:25"));
    expect(vuelo830).toMatchObject({ missingVehicle: false, missingDriver: false, overbooked: true, capacity: 19 });
    expect(summary).toEqual({ services: 3, passengers: 33, missingVehicle: 1, missingDriver: 1, overbooked: 1 });
  });

  it("deja afuera los vuelos sin pasajeros ni combis y las salidas canceladas", () => {
    const { rows } = buildDayBoard({
      dateKey: "2026-11-17",
      schedules: [{ id: "s1", routeId: "r1", from: "A", to: "B", departureAt: at("09:00"), status: "CANCELLED", passengers: 0, vehicle: combi, driver: null }],
      flights: [{ id: "f1", number: "AR1658", direction: "ARRIVAL", scheduledAt: at("19:05"), estimatedAt: null, pickupStart: null, status: "SCHEDULED", passengers: 0, units: [] }],
      chapelco: [{ operationDayId: null, routeId: "c", dateKey: "2026-11-17", status: "OPEN", passengers: 0, firstAscent: null, units: [] }],
      specialTrips: [{ id: "t1", client: "X", passengers: 10, status: "CANCELLED", firstLegAt: null, units: [] }]
    });
    expect(rows).toEqual([]);
  });

  it("un vuelo cancelado con pasajeros no pide nave, pero sigue a la vista", () => {
    const row = flightRow({ id: "f1", number: "WJ3044", direction: "ARRIVAL", scheduledAt: at("21:15"), estimatedAt: null, pickupStart: null, status: "CANCELLED", passengers: 3, units: [] }, "2026-11-17");
    expect(row).toMatchObject({ missingVehicle: false, status: "Cancelado", href: "/admin/aeropuerto?date=2026-11-17#vuelo-f1" });
  });

  it("Chapelco y viajes especiales: falta chofer si alguna unidad no lo tiene", () => {
    const { rows } = buildDayBoard({
      dateKey: "2026-11-17",
      schedules: [],
      flights: [],
      chapelco: [{ operationDayId: "o1", routeId: "c", dateKey: "2026-11-17", status: "OPEN", passengers: 30, firstAscent: at("08:30"), units: [
        { id: "u1", capacity: 19, vehicle: { id: "v1", name: "Combi 243" }, driver: chofer },
        { id: "u2", capacity: 15, vehicle: { id: "v2", name: "Sprinter 196" }, driver: null }
      ] }],
      specialTrips: [{ id: "t1", client: "Colegio", passengers: null, status: "CONFIRMED", firstLegAt: null, units: [{ id: "x1", startsAt: at("06:00"), vehicle: combi, driver: chofer }] }]
    });
    expect(rows[0]).toMatchObject({ area: "ESPECIAL", missingDriver: false, passengers: 0, at: at("06:00") });
    expect(rows[1]).toMatchObject({ area: "CHAPELCO", missingDriver: true, capacity: 34, atLabel: "Primer ascenso" });
  });

  it("lo que no tiene hora va al final", () => {
    const base: Omit<BoardRow, "title" | "at"> = { key: "", area: "RUTA", serviceId: "", atLabel: "", detail: null, passengers: 0, capacity: null, units: [], missingVehicle: false, missingDriver: false, overbooked: false, status: null, href: "" };
    const rows: BoardRow[] = [{ ...base, title: "b", at: null }, { ...base, title: "a", at: at("10:00") }, { ...base, title: "c", at: at("09:00") }];
    expect(sortBoard(rows).map((row) => row.title)).toEqual(["c", "a", "b"]);
  });

  it("nombre del chofer: el nombre cargado o, si no hay, el email", () => {
    expect(personName(chofer)).toBe("Ramón Paz");
    expect(personName({ id: "d2", name: "  ", email: "sin@nombre.test" })).toBe("sin@nombre.test");
    expect(personName(null)).toBeNull();
  });

  it("fechas del día en hora de Argentina", () => {
    expect(localDateKey(new Date("2026-11-17T02:30:00Z"))).toBe("2026-11-16");
    expect(dayRange("2026-11-17")).toEqual({ from: new Date("2026-11-17T03:00:00Z"), to: new Date("2026-11-18T03:00:00Z") });
    expect(shiftDateKey("2026-11-30", 1)).toBe("2026-12-01");
    expect(isDateKey("2026-11-17")).toBe(true);
    expect(isDateKey("17/11/2026")).toBe(false);
    expect(isDateKey(undefined)).toBe(false);
  });
});
