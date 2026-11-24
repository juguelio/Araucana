import { beforeEach, expect, it, vi } from "vitest";
import { loadPublicServiceWeek } from "@/app/admin/servicio-publico/semana/data";
import { GET as loadSpecialTripCalendar } from "@/app/admin/viajes-especiales/semana/datos/route";
import { loadSpecialTripsWeek } from "@/app/admin/viajes-especiales/semana/data";
import { adminScheduleWhere } from "@/lib/booking/admin-filters";
import type { AdminScheduleRowDto } from "@/lib/booking/types";

const mock = vi.hoisted(() => ({ user: vi.fn(), schedules: vi.fn(), trips: vi.fn() }));
vi.mock("@/lib/auth/service", () => ({ getAppUserFromToken: mock.user, getTokenFromRequest: () => null }));
vi.mock("@/lib/booking/repository", () => ({ listAdminSchedules: mock.schedules }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { specialTrip: { findMany: mock.trips } } }));

beforeEach(() => vi.resetAllMocks());

it("carga las salidas de la semana en un rango argentino, conserva el filtro y calcula el resumen", async () => {
  const row: AdminScheduleRowDto = {
    id: "sma", from: "San Martín de los Andes", to: "Villa Traful", route: "SMA → Traful", routeId: "r1",
    bookingMode: "SEATED", vehicleId: "v1", vehicleName: "Combi", vehiclePlate: null, vehicleInternalNumber: null,
    departureAt: new Date("2026-11-24T02:00:00Z"), arrivalAt: new Date("2026-11-24T03:00:00Z"),
    status: "OPEN", availableSeats: 3, totalSeats: 5
  };
  mock.schedules.mockResolvedValue([row, { ...row, id: "traful", from: "Villa Traful" }]);

  const week = await loadPublicServiceWeek("2026-11-23", "sma");

  const filters = { date: "2026-11-23", until: "2026-11-29", activeRoutesOnly: true };
  expect(mock.schedules).toHaveBeenCalledExactlyOnceWith(filters);
  expect(adminScheduleWhere(filters).AND).toContainEqual({
    departureAt: { gte: new Date("2026-11-23T03:00:00Z"), lt: new Date("2026-11-30T03:00:00Z") }
  });
  expect(week.days[0]).toMatchObject({ date: "2026-11-23", cards: [{ id: "sma", kicker: "SMA · 23:00" }] });
  expect(week.days[1].cards).toEqual([]);
  expect(week.summary?.map(({ value }) => value)).toEqual([1, 2, 3]);
});

it("muestra un viaje que empezó la semana anterior y asigna las naves a sus días de ocupación", async () => {
  mock.trips.mockResolvedValue([{
    id: "viaje", client: "Grupo", destinationSearch: "Aeropuerto\nVilla Traful", status: "CONFIRMED", passengers: 6,
    serviceDate: new Date("2026-11-29"), endDate: new Date("2026-12-01"),
    assignments: [
      { startsAt: new Date("2026-11-30T03:00:00Z"), endsAt: new Date("2026-12-01T03:00:00Z"), vehicle: { name: "Combi" } }
    ]
  }]);
  const all = await loadSpecialTripsWeek("2026-11-30", { q: "", status: "", vehicleId: "" });
  expect(all.days[0].cards[0]).toMatchObject({ kicker: "Día 2 de 3 · 00:00", details: ["Aeropuerto · Villa Traful", "Combi", "6 pasajeros"] });
  expect(all.days[0].href).toBe("/admin/viajes-especiales/dia?fecha=2026-11-30");
  expect(all.days[0].cards[0].href).toBe("/admin/viajes-especiales/dia?fecha=2026-11-30");
  expect(all.days[6].href).toBe("/admin/viajes-especiales/dia?fecha=2026-12-06");
  expect(all.days[1].cards[0]).toMatchObject({ kicker: "Día 3 de 3", details: ["Aeropuerto · Villa Traful", "Sin nave asignada", "6 pasajeros"] });
  expect(all.days[2].cards).toEqual([]);

  const filtered = await loadSpecialTripsWeek("2026-11-30", { q: "", status: "", vehicleId: "v1" });
  expect(filtered.days[0].cards).toHaveLength(1);
  expect(filtered.days[1].cards).toHaveLength(0);
  expect(mock.trips.mock.lastCall?.[0].select.assignments.where.vehicleId).toBe("v1");
});

it("exige una sesión activa de oficina para consultar más días y rechaza fechas inválidas", async () => {
  const request = new Request("http://localhost/admin/viajes-especiales/semana/datos?semana=2026-02-31");
  mock.user.mockResolvedValue({ isActive: true, role: "DRIVER" });
  expect((await loadSpecialTripCalendar(request)).status).toBe(403);
  mock.user.mockResolvedValue({ isActive: true, role: "SECRETARY" });
  expect((await loadSpecialTripCalendar(request)).status).toBe(400);
  expect(mock.trips).not.toHaveBeenCalled();
});
