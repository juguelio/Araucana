import { describe, expect, it } from "vitest";
import { buildDayBoard, dayRange, flightRow, isDateKey, localDateKey, personName, scheduleRows, shiftDateKey, sortBoard, type BoardRow, type ScheduleInput } from "./day-board";

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
    expect(summary).toEqual({ services: 3, programmed: 0, passengers: 33, missingVehicle: 1, missingDriver: 1, overbooked: 1 });
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

  it("identifica los traslados con clientes pendientes de verificar", () => {
    const row = flightRow({ id: "f1", number: "AR1652", direction: "ARRIVAL", source: "REVISAR", scheduledAt: at("12:15"), estimatedAt: null, pickupStart: null, status: "SCHEDULED", passengers: 2, units: [] }, "2026-11-17");
    expect(row).toMatchObject({ status: "Revisar vuelo", passengers: 2, serviceId: "f1" });
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
    const base: Omit<BoardRow, "title" | "at"> = { key: "", area: "RUTA", serviceId: "", atLabel: "", detail: null, passengers: 0, capacity: null, units: [], missingVehicle: false, missingDriver: false, overbooked: false, programmed: false, status: null, href: "", editHref: "" };
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

  it("salidas viejas de la misma ruta a la misma hora siguen juntas en una fila", () => {
    const sprinter = { id: "v2", name: "Sprinter 196", seats: 19 };
    const [row, otra] = scheduleRows([
      { id: "s1", routeId: "r1", from: "San Martín", to: "Villa Traful", departureAt: at("08:00"), status: "OPEN", passengers: 15, reservations: 4, vehicle: combi, driver: chofer },
      { id: "s2", routeId: "r1", from: "San Martín", to: "Villa Traful", departureAt: at("08:00"), status: "OPEN", passengers: 0, reservations: 0, vehicle: sprinter, driver: null },
      { id: "s3", routeId: "r1", from: "San Martín", to: "Villa Traful", departureAt: at("14:30"), status: "CLOSED", passengers: 2, vehicle: combi, driver: null }
    ]);
    expect(row).toMatchObject({ passengers: 15, capacity: 38, missingDriver: true, detail: "2 naves", routeId: "r1", status: null });
    expect(row.units.map((unit) => [unit.vehicleName, unit.passengers, unit.removable])).toEqual([["Combi 243", 15, false], ["Sprinter 196", 0, true]]);
    expect(row.units[1].editHref).toBe("/admin/rutas/r1/salidas/s2/editar");
    // Una salida sola, cerrada: el estado va en la fila. Sin el total de reservas, se mira el de pasajeros.
    expect(otra).toMatchObject({ status: "Cerrada", detail: null });
    expect(otra.units[0].removable).toBe(false);
  });

  it("una salida con varias naves es una fila: la principal y las sumadas, cada una con su chofer", () => {
    const sprinter = { id: "v2", name: "Sprinter 196", seats: 15 };
    const [row] = scheduleRows([{
      id: "s1", routeId: "r1", from: "San Martín", to: "Villa Traful", departureAt: at("08:00"), status: "OPEN",
      passengers: 30, reservations: 6, vehicle: combi, driver: chofer,
      extraUnits: [{ id: "u1", vehicle: sprinter, driver: null }]
    }]);
    expect(row).toMatchObject({ passengers: 30, capacity: 34, overbooked: false, missingDriver: true, detail: "2 naves", serviceId: "s1" });
    expect(row.units.map((unit) => [unit.id, unit.unitKind, unit.scheduleId, unit.vehicleName, unit.removable])).toEqual([
      ["s1", "PRIMARY", "s1", "Combi 243", true],
      ["u1", "EXTRA", "s1", "Sprinter 196", true]
    ]);
    // Con una sola salida no se reparte la cuenta de pasajeros por nave: es de la salida entera.
    expect(row.units[0].passengers).toBeUndefined();
  });
});

describe("salidas del día: la programación no es servicio (issue #258)", () => {
  const salidaProgramada = (id: string, hm: string): ScheduleInput => ({
    id,
    routeId: "r1",
    from: "San Martín de los Andes",
    to: "Villa Traful",
    departureAt: at(hm),
    status: "OPEN",
    passengers: 0,
    reservations: 0,
    vehicle: combi,
    driver: null
  });

  it("separa la salida que espera nave de otra de la misma ruta y hora", () => {
    const conNave = salidaProgramada("con-nave", "08:00");
    const rows = scheduleRows([conNave, { ...conNave, id: "pendiente", vehicle: null }]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ serviceId: "pendiente", missingVehicle: true, units: [], capacity: null });
    expect(rows[0].key).not.toBe(rows[1].key);
  });

  it("un día con 9 salidas programadas y ninguna reserva no tiene ningún servicio", () => {
    const { rows, summary } = buildDayBoard({
      dateKey: "2026-11-17",
      schedules: ["08:00", "09:00", "09:30", "10:00", "10:30", "11:00", "12:00", "14:00", "15:00"].map((hm, index) => salidaProgramada(`s${index}`, hm)),
      flights: [],
      chapelco: [],
      specialTrips: []
    });
    expect(rows).toHaveLength(9);
    expect(rows.every((row) => row.programmed)).toBe(true);
    // Ni servicios, ni pasajeros, ni «falta chofer»: nada de eso es del día hasta que haya reservas.
    expect(summary).toEqual({ services: 0, programmed: 9, passengers: 0, missingVehicle: 0, missingDriver: 0, overbooked: 0 });
  });

  it("la salida con reservas sigue siendo servicio y la programada no suma", () => {
    const { rows, summary } = buildDayBoard({
      dateKey: "2026-11-17",
      schedules: [
        { ...salidaProgramada("s1", "09:00"), passengers: 6, reservations: 3 },
        salidaProgramada("s2", "10:00"),
        salidaProgramada("s3", "11:00")
      ],
      flights: [],
      chapelco: [],
      specialTrips: []
    });
    expect(rows.filter((row) => row.programmed).map((row) => row.serviceId)).toEqual(["s2", "s3"]);
    expect(rows.filter((row) => !row.programmed).map((row) => row.serviceId)).toEqual(["s1"]);
    expect(summary).toMatchObject({ services: 1, programmed: 2, passengers: 6, missingDriver: 1 });
  });

  it("un vuelo o un viaje especial nunca se marcan como programación", () => {
    const { rows } = buildDayBoard({
      dateKey: "2026-11-17",
      schedules: [],
      flights: [{ id: "f1", number: "AR1657", direction: "DEPARTURE", scheduledAt: at("16:45"), estimatedAt: null, pickupStart: at("13:30"), status: "SCHEDULED", passengers: 4, units: [] }],
      chapelco: [],
      specialTrips: [{ id: "t1", client: "Colegio Nacional", passengers: 40, status: "CONFIRMED", firstLegAt: at("07:00"), units: [] }]
    });
    expect(rows.map((row) => row.programmed)).toEqual([false, false]);
  });

  it("un viaje de varios días figura cada día: sale con su hora y después sigue afuera, arriba de todo", () => {
    const nave = { id: "a1", startsAt: at("07:00"), endsAt: new Date("2026-11-21T23:00:00Z"), vehicle: combi, driver: chofer };
    const viaje = { id: "t9", client: "Collipulli (Chile)", passengers: 23, status: "CONFIRMED", firstLegAt: null, units: [nave] };
    const otro = { id: "s1", routeId: "r1", from: "San Martín", to: "Villa Traful", departureAt: at("06:30"), status: "OPEN", passengers: 6, vehicle: combi, driver: null };
    const sale = buildDayBoard({ dateKey: "2026-11-17", schedules: [otro], flights: [], chapelco: [], specialTrips: [{ ...viaje, day: { number: 1, total: 5, returnLabel: "vie 21" } }] }).rows;
    expect(sale.map((r) => r.area)).toEqual(["RUTA", "ESPECIAL"]);
    const especialSale = sale.find((r) => r.area === "ESPECIAL")!;
    expect(especialSale).toMatchObject({ at: at("07:00"), atLabel: "Sale", detail: "Viaje especial · sale hoy, vuelve el vie 21" });
    expect(especialSale.continuing).toBeUndefined();

    const afuera = buildDayBoard({ dateKey: "2026-11-18", schedules: [otro], flights: [], chapelco: [], specialTrips: [{ ...viaje, continuing: true, day: { number: 2, total: 5, returnLabel: "vie 21" } }] }).rows;
    expect(afuera[0]).toMatchObject({ area: "ESPECIAL", at: null, continuing: true, timeText: "Día 2", atLabel: "de 5", detail: "Viaje especial · en viaje, vuelve el vie 21" });
    // Con su nave y su chofer a la vista, y sin pedir nada que ya está asignado.
    expect(afuera[0].units[0]).toMatchObject({ vehicleName: "Combi 243", driverName: "Ramón Paz" });
    expect(afuera[0]).toMatchObject({ missingVehicle: false, missingDriver: false });

    const vuelve = buildDayBoard({ dateKey: "2026-11-21", schedules: [], flights: [], chapelco: [], specialTrips: [{ ...viaje, continuing: true, day: { number: 5, total: 5, returnLabel: "vie 21" } }] }).rows;
    expect(vuelve[0]).toMatchObject({ timeText: "Día 5", detail: "Viaje especial · vuelve hoy" });
  });

  it("un viaje de un día con la nave ocupada desde antes también sigue arriba", () => {
    const rows = buildDayBoard({ dateKey: "2026-11-18", schedules: [], flights: [], chapelco: [], specialTrips: [
      { id: "t1", client: "Viejo", passengers: 10, status: "CONFIRMED", firstLegAt: null, continuing: true, units: [{ id: "x", startsAt: at("06:00"), vehicle: combi, driver: chofer }] }
    ] }).rows;
    expect(rows[0]).toMatchObject({ continuing: true, timeText: "—", atLabel: "En viaje", detail: "Viaje especial · la nave sigue ocupada desde antes" });
  });
});
