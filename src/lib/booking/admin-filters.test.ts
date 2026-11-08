import { describe, expect, it } from "vitest";
import { adminReservationFiltersSchema, adminReservationWhere, adminReservationsPage, adminScheduleFiltersSchema, adminScheduleWhere } from "./admin-filters";

describe("reservation search", () => {
  it("rejects invalid calendar days instead of silently searching all reservations", () => {
    expect(adminReservationFiltersSchema.safeParse({ date: "2026-02-30" }).success).toBe(false);
    expect(adminReservationFiltersSchema.safeParse({ date: "not-a-date" }).success).toBe(false);
  });
  it("combines filters and uses the travel day for all three booking modes", () => {
    const where = adminReservationWhere({ code: " arc-123 ", route: " SMA ", scheduleId: "departure", date: "2026-11-03" });
    expect(where.AND).toEqual([
      { code: { contains: "arc-123", mode: "insensitive" } },
      { scheduleId: "departure" },
      expect.objectContaining({ OR: expect.any(Array) }),
      { OR: [
        { schedule: { is: { departureAt: { gte: new Date("2026-11-03T03:00:00Z"), lt: new Date("2026-11-04T03:00:00Z") } } } },
        { airportDetails: { is: { serviceDate: { gte: new Date("2026-11-03T03:00:00Z"), lt: new Date("2026-11-04T03:00:00Z") } } } },
        { chapelcoDetails: { is: { serviceDate: new Date("2026-11-03T00:00:00Z") } } }
      ] }
    ]);
  });
});

describe("busqueda de salidas (alta manual)", () => {
  it("filtra por origen/destino y por dia argentino de viaje", () => {
    expect(adminScheduleWhere({ from: " SMA ", to: "Bariloche", date: "2026-11-05" })).toEqual({
      AND: [
        { route: { is: { from: { equals: "SMA", mode: "insensitive" } } } },
        { route: { is: { to: { equals: "Bariloche", mode: "insensitive" } } } },
        { departureAt: { gte: new Date("2026-11-05T03:00:00Z"), lt: new Date("2026-11-06T03:00:00Z") } }
      ]
    });
  });

  it("se queda con lo reservable: desde ahora, sin rutas ni naves dadas de baja", () => {
    // El alta rechaza una salida que ya arrancó (aunque sea del mismo día) y las de ruta/nave inactiva:
    // el selector tiene que filtrar por el mismo criterio, no por la medianoche.
    expect(adminScheduleWhere({ bookableOnly: true }, new Date("2026-11-05T15:00:00Z"))).toEqual({
      AND: [
        { status: { in: ["OPEN", "DOCUMENTATION"] } },
        { departureAt: { gte: new Date("2026-11-05T15:00:00Z") } },
        { route: { is: { isActive: true } } },
        { vehicle: { is: { isActive: true } } }
      ]
    });
  });

  it("sin filtros no filtra nada", () => {
    expect(adminScheduleWhere({})).toEqual({});
  });

  it("rechaza dias invalidos en vez de mostrar toda la temporada", () => {
    expect(adminScheduleFiltersSchema.safeParse({ date: "2026-02-30" }).success).toBe(false);
  });
});

describe("paginacion del listado de reservas", () => {
  it("una pagina invalida cae en la primera en vez de romper la busqueda", () => {
    expect(adminReservationsPage({})).toBe(1);
    expect(adminReservationsPage({ page: "0" })).toBe(1);
    expect(adminReservationsPage({ page: "abc" })).toBe(1);
    expect(adminReservationsPage({ page: "-3" })).toBe(1);
    expect(adminReservationsPage({ page: "3" })).toBe(3);
  });

  it("el parametro de pagina no ensucia el where de la busqueda", () => {
    expect(adminReservationWhere({ page: 4, code: "ARC" })).toEqual({
      AND: [{ code: { contains: "ARC", mode: "insensitive" } }]
    });
  });
});

describe("colas de cobro del listado", () => {
  it("pide comprobante subido y pago todavia pendiente", () => {
    expect(adminReservationWhere({ payment: "receipt-pending" })).toEqual({
      AND: [
        { status: "PENDING_PAYMENT" },
        { payment: { is: { status: "PENDING", receiptBlobPathname: { not: null } } } }
      ]
    });
  });

  it("pide los comprobantes rechazados", () => {
    expect(adminReservationWhere({ payment: "rejected" })).toEqual({
      AND: [{ payment: { is: { status: "REJECTED" } } }]
    });
  });

  it("una cola desconocida falla en vez de mostrar todo como si estuviera filtrado", () => {
    expect(() => adminReservationWhere({ payment: "inventada" as never })).toThrow();
  });

  it("el calendario de una ruta pide sólo sus salidas (antes traía las de todas y filtraba en la página)", () => {
    expect(adminScheduleWhere({ routeId: "route-sma-villa-traful" })).toEqual({ AND: [{ routeId: "route-sma-villa-traful" }] });
    expect(() => adminScheduleFiltersSchema.parse({ routeId: "" })).toThrow();
  });
});
