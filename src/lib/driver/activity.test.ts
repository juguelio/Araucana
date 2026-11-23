import { expect, it, vi } from "vitest";
import { activityStatus, filterDriverActivity, type DriverActivity } from "./activity";
import { listDriverActivity } from "./activity-repository";

const db = vi.hoisted(() => ({
  schoolRun: { findMany: vi.fn().mockResolvedValue([{ id: "e1", serviceDate: new Date("2026-11-23"), routeName: "Escuela", shift: "Mañana", vehicle: null }]) },
  schedule: { findMany: vi.fn() },
  airportVehicleAssignment: { findMany: vi.fn() },
  chapelcoVehicleDuty: { findMany: vi.fn() },
  specialTripAssignment: { findMany: vi.fn() }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

it("incluye la nave adicional del chofer y enlaza la orden al vuelo, nave y fecha de reserva", async () => {
  const flightDate = new Date("2026-11-23T04:00:00Z");
  db.schedule.findMany.mockResolvedValue([{
    id: "s1", routeId: "r1", departureAt: flightDate, arrivalAt: new Date("2026-11-23T06:00:00Z"),
    status: "OPEN", route: { from: "San Martín", to: "Villa Traful" },
    driverId: "otro-chofer", vehicle: { name: "Nave principal" },
    extraUnits: [{ id: "su2", vehicle: { name: "Nave adicional" } }]
  }]);
  db.airportVehicleAssignment.findMany.mockResolvedValue([{
    id: "a1", vehicleId: "v1", vehicle: { name: "Nave del vuelo" },
    flight: { id: "f1", number: "AR1660", direction: "DEPARTURE", status: "SCHEDULED", scheduledAt: flightDate,
      reservations: [{ serviceDate: new Date("2026-11-23T03:00:00Z") }] }
  }]);
  db.chapelcoVehicleDuty.findMany.mockResolvedValue([{
    id: "c1", status: "ACTIVE", vehicle: { name: "Nave Chapelco" },
    operationDay: { serviceDate: new Date("2026-11-23T00:00:00Z"), route: { from: "San Martín", to: "Chapelco" } }
  }]);
  db.specialTripAssignment.findMany.mockResolvedValue([]);

  const entries = await listDriverActivity("chofer-1");
  expect(db.schedule.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { OR: [{ driverId: "chofer-1" }, { extraUnits: { some: { driverId: "chofer-1" } } }] }
  }));
  expect(entries).toHaveLength(4);
  expect(entries[3]).toMatchObject({ area: "ESCOLAR", date: "2026-11-23", startsAt: null, vehicle: "Sin nave asignada" });
  expect(entries[0]).toMatchObject({ vehicle: "Nave adicional", links: expect.arrayContaining([
    { href: "/admin/rutas/r1/salidas/s1/planilla", label: "Ver planilla" }
  ]) });
  expect(entries[1]).toMatchObject({ date: "2026-11-22", links: expect.arrayContaining([
    { href: "/admin/aeropuerto/orden-de-servicio/ver?date=2026-11-23&flight=f1&vehicle=v1", label: "Ver orden de servicio" }
  ]) });
  expect(entries[2]).toMatchObject({ area: "CHAPELCO", date: "2026-11-23", startsAt: null });
});

it("conserva en el día actual un viaje de varios días y filtra el historial por fechas y tipo", () => {
  const today = "2026-11-22";
  const now = new Date("2026-11-22T15:00:00Z");
  const previous: DriverActivity = {
    id: "ruta", area: "RUTA", date: "2026-11-21", startsAt: new Date("2026-11-21T15:00:00Z"),
    endsAt: new Date("2026-11-21T17:00:00Z"), title: "Ruta", vehicle: "Nave", links: []
  };
  const ongoing: DriverActivity = { ...previous, id: "viaje", area: "ESPECIAL", endsAt: new Date("2026-11-23T15:00:00Z") };
  const future: DriverActivity = { ...previous, id: "ski", area: "CHAPELCO", date: "2026-11-24", startsAt: null, endsAt: null };
  const entries = [future, previous, ongoing];

  expect(filterDriverActivity(entries, { period: "hoy", today })).toEqual([ongoing]);
  expect(filterDriverActivity(entries, { period: "proximas", today })).toEqual([future]);
  expect(filterDriverActivity(entries, { period: "historial", today, area: "RUTA", from: "2026-11-21", to: "2026-11-21" })).toEqual([previous]);
  expect(filterDriverActivity(entries, { period: "historial", today, from: today })).toEqual([]);
  expect(activityStatus(ongoing, now)).toBe("En horario de servicio");
  expect(activityStatus({ ...ongoing, status: "Cancelado" }, now)).toBe("Cancelado");
});
