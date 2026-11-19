import { expect, it } from "vitest";
import { chapelcoRow, flightRow, scheduleRows, specialTripRow } from "./day-board";
import { dispatchIssues, serviceReservationScope, type DispatchAssignment } from "./dispatch";

const job = (name: string, start: number | null, end: number | null): DispatchAssignment => ({
  key: name, rowKey: name, title: name, href: "/admin", area: "ESPECIAL", start, end,
  vehicleId: "bus", vehicleName: "Bus", driverId: "ana", driverName: "Ana"
});

it("admite turnos sucesivos y marca los dos servicios cuando se pisan", () => {
  const first = job("cerro", 9, 11);
  const next = job("ruta", 11, 13);
  expect(dispatchIssues([], [first, next, job("a coordinar", null, null)], []).size).toBe(0);
  const issues = dispatchIssues([], [first, { ...next, start: 10 }], []);
  expect(issues.get("cerro")).toEqual(["Cruce de Bus con ruta", "Cruce de Ana con ruta"]);
  expect(issues.get("ruta")).toHaveLength(2);
});

it("una recorrida compartida sólo admite el mismo chofer simultáneo en la misma nave", () => {
  const a = { ...job("vuelo A", 10, 13), sharedPickupId: "grupo" };
  const b = { ...job("vuelo B", 10, 14), sharedPickupId: "grupo" };
  expect(dispatchIssues([], [a, b], []).size).toBe(0);
  expect(dispatchIssues([], [a, { ...b, vehicleId: "otra" }], []).get("vuelo A")).toEqual(["Cruce de Ana con vuelo B"]);
});

it("un daño grave abierto afecta incluso servicios programados y se libera cuando se repara", () => {
  const row = specialTripRow({ id: "club", client: "Club", passengers: 0, status: "OPEN", firstLegAt: null,
    units: [{ id: "unidad", vehicle: { id: "bus", name: "Bus", seats: 30 }, startsAt: new Date(), driver: null }] });
  row.programmed = true;
  const damage = { id: "rotura", vehicleId: "bus", severity: "GRAVE", status: "EN_REPARACION", description: "Frenos" };
  expect(dispatchIssues([row], [], [damage]).get(row.key)).toEqual(["Bus tiene un daño grave"]);
  expect(dispatchIssues([row], [], [{ ...damage, status: "REPARADO" }]).size).toBe(0);
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
