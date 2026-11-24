import { expect, it } from "vitest";
import { chapelcoRow, flightRow, scheduleRows, specialTripRow } from "./day-board";
import { daniosPorNave, dispatchIssues, dispatchReview, serviceReservationScope, type DispatchAssignment } from "./dispatch";

const job = (name: string, start: number | null, end: number | null): DispatchAssignment => ({
  key: name, rowKey: name, title: name, href: "/admin", area: "ESPECIAL", start, end,
  vehicleId: "bus", vehicleName: "Bus", driverId: "ana", driverName: "Ana"
});

it("admite turnos sucesivos y marca los dos servicios cuando se pisan", () => {
  const first = job("cerro", 9, 11);
  const next = job("ruta", 11, 13);
  expect(dispatchIssues([], [first, next, job("a coordinar", null, null)], new Map()).size).toBe(0);
  const issues = dispatchIssues([], [first, { ...next, start: 10 }], new Map());
  expect(issues.get("cerro")).toEqual(["Cruce de Bus con ruta", "Cruce de Ana con ruta"]);
  expect(issues.get("ruta")).toHaveLength(2);
  const { related } = dispatchReview([], [first, { ...next, start: 10 }], new Map());
  expect([...related.get("cerro")!]).toEqual([["ruta", "ruta"]]);
  expect([...related.get("ruta")!]).toEqual([["cerro", "cerro"]]);
});

it("una recorrida compartida sólo admite el mismo chofer simultáneo en la misma nave", () => {
  const a = { ...job("vuelo A", 10, 13), sharedPickupId: "grupo" };
  const b = { ...job("vuelo B", 10, 14), sharedPickupId: "grupo" };
  expect(dispatchIssues([], [a, b], new Map()).size).toBe(0);
  expect(dispatchIssues([], [a, { ...b, vehicleId: "otra" }], new Map()).get("vuelo A")).toEqual(["Cruce de Ana con vuelo B"]);
});

it("un daño grave abierto afecta incluso servicios programados y se libera cuando se repara", () => {
  const row = specialTripRow({ id: "club", client: "Club", passengers: 0, status: "OPEN", firstLegAt: null,
    units: [{ id: "unidad", vehicle: { id: "bus", name: "Bus", seats: 30 }, startsAt: new Date(), driver: null }] });
  row.programmed = true;
  const damage = { id: "rotura", vehicleId: "bus", severity: "GRAVE", status: "EN_REPARACION", description: "Frenos" };
  expect(dispatchIssues([row], [], daniosPorNave([damage])).get(row.key)).toEqual(["Bus está en reparación"]);
  expect(dispatchIssues([row], [], daniosPorNave([{ ...damage, status: "REPARADO" }])).size).toBe(0);
});

it("el listado de pasajeros reúne las salidas agrupadas y distingue vuelo y ruta de Chapelco", () => {
  const date = new Date("2030-04-29T14:00:00Z");
  const vehicle = { id: "bus", name: "Bus", seats: 30 };
  const route = { routeId: "traful", from: "Centro", to: "Traful", departureAt: date, status: "OPEN", passengers: 2, vehicle, driver: null };
  const [row] = scheduleRows([{ ...route, id: "ida-1" }, { ...route, id: "ida-2" }]);
  expect(serviceReservationScope(row)).toEqual({ scheduleId: { in: ["ida-1", "ida-2"] } });
  const flight = flightRow({ id: "f1", number: "AR1657", direction: "ARRIVAL", scheduledAt: date, estimatedAt: null, pickupStart: null, status: "SCHEDULED", passengers: 1, units: [] }, "2030-04-29");
  expect(serviceReservationScope(flight)).toEqual({ airportDetails: { is: { flightId: "f1" } } });
  const cerro = chapelcoRow({ routeId: "cerro-1", operationDayId: null, dateKey: "2030-04-29", status: "OPEN", passengers: 2, firstAscent: date, units: [] });
  expect(serviceReservationScope(cerro)).toEqual({ bookingMode: "CHAPELCO", routeId: "cerro-1" });
});

it("una ruta inactiva con reservas queda pendiente y la programación vacía sigue consultable", () => {
  const schedule = { id: "salida", routeId: "ruta", from: "Centro", to: "Terminal", departureAt: new Date(), status: "OPEN",
    vehicle: { id: "v", name: "Combi", seats: 15 }, driver: null, routeActive: false };
  const [conReservas] = scheduleRows([{ ...schedule, passengers: 2 }]);
  expect(dispatchIssues([conReservas], [], new Map()).get(conReservas.key)).toContain("Ruta inactiva con pasajeros");
  const [sinReservas] = scheduleRows([{ ...schedule, passengers: 0 }]);
  expect(sinReservas.programmed).toBe(true);
  expect(dispatchIssues([sinReservas], [], new Map()).size).toBe(0);
});

it("prioriza la nave averiada en servicio, después lo que falta y finalmente un tramo ya terminado", () => {
  const vehicle = { id: "bus", name: "Bus", seats: 15 };
  const broken = specialTripRow({ id: "club", client: "Club", passengers: 15, status: "OPEN", firstLegAt: new Date(9), units: [
    { id: "a", startsAt: new Date(9), endsAt: new Date(11), vehicle, driver: null }
  ] });
  const empty = { ...broken, key: "pendiente", units: [], missingVehicle: true };
  const damaged = daniosPorNave([{ id: "d", vehicleId: "bus", status: "EN_REPARACION", severity: "GRAVE", description: "Taller" }]);
  const assignments = [{ ...job("club", 9, 11), rowKey: broken.key }];
  expect(dispatchReview([empty, broken], assignments, damaged, 10).pending.map(r => r.key)).toEqual([broken.key, empty.key]);
  expect(dispatchReview([empty, broken], assignments, damaged, 12).pending.map(r => r.key)).toEqual([empty.key, broken.key]);
});
