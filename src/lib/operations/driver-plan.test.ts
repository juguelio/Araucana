import { expect, it } from "vitest";
import { driverPlan } from "./driver-plan";
import { buildDayBoard, schoolWindow } from "./day-board";
import { dispatchIssues, type DispatchAssignment } from "./dispatch";
import { schoolDates, schoolOccurrenceId } from "./school-series";

it("conserva un turno escolar sin inventar horas ni pasajeros y detecta sólo las asignaciones que faltan", () => {
  const school = { id: "e1", routeName: "Escuela", shift: "Mañana", revision: 0, companion: null,
    driver: { id: "d", name: "Ana", email: "d@example.test" }, vehicle: null };
  const { rows, summary } = buildDayBoard({ dateKey: "2026-11-22", schedules: [], flights: [], chapelco: [], specialTrips: [], schools: [school] });
  expect(rows[0]).toMatchObject({ timeText: "Mañana", at: null, missingVehicle: true, missingDriver: false, capacity: null });
  expect(summary).toMatchObject({ services: 1, passengers: 0 });
  expect(schoolWindow("2026-11-22","7:30 a 08:45")).toEqual({ start: new Date("2026-11-22T10:30Z"), end: new Date("2026-11-22T11:45Z") });
});

it("un segundo chofer ocupa su bloque sin duplicar la nave y su aviso cambia cuando se modifica el horario", () => {
  const job: DispatchAssignment = { key: "a", rowKey: "viaje", title: "Pucón", area: "ESPECIAL", href: "/admin", vehicleId: "v", vehicleName: "Unidad 30",
    driverId: "ana", driverName: "Ana", coDriverId: "sol", coDriverName: "Sol", start: +new Date("2026-11-21T12:00Z"), end: +new Date("2026-11-24T23:00Z") };
  const other = { ...job, key: "b", rowKey: "otro", title: "Escuela", vehicleId: null, coDriverId: null, driverId: "sol", driverName: "Sol" };
  expect(dispatchIssues([], [job,other], new Map()).get("viaje")).toEqual(["Cruce de Sol con Escuela"]);
  const plan = driverPlan("2026-11-22", "Sol", [job]);
  expect(plan.message).toMatch(/21\/11 09:00 – 24\/11 20:00/);
  expect(plan.message).toContain("Ana y Sol");
  expect(driverPlan("2026-11-22","Sol",[{ ...job, end: job.end! - 60000 }]).fingerprint).not.toBe(plan.fingerprint);
});

it("repite sólo los días elegidos, acepta excepciones e identifica cada copia al reintentar", () => {
  const dates = schoolDates("2026-11-23","2026-12-07",["1","3"],"25/11/2026, 2026-12-07");
  expect(dates).toEqual(["2026-11-23","2026-11-30","2026-12-02"]);
  expect(schoolOccurrenceId("e1", dates[0])).toBe(schoolOccurrenceId("e1","2026-11-23"));
  expect(schoolOccurrenceId("e2", dates[0])).not.toBe(schoolOccurrenceId("e1",dates[0]));
  expect(() => schoolDates("2026-11-23","2026-12-07",["1"],"31/11/2026")).toThrow();
});
