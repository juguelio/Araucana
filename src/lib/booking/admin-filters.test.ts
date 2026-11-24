import { describe, expect, it } from "vitest";
import { ADMIN_RESERVATIONS_PAGE_SIZE, adminReservationFiltersSchema, adminReservationWhere, adminReservationsPage, adminReservationsPageSize, adminScheduleFiltersSchema, adminScheduleWhere, formatTravelDay, travelDayKey } from "./admin-filters";

describe("fecha del viaje", () => {
  it("usa el día calendario de Chapelco sin correrlo de día", () => {
    // Chapelco guarda 2026-11-13 como medianoche UTC.
    expect(travelDayKey(new Date("2026-11-13T00:00:00Z"), null)).toBe("2026-11-13");
  });

  it("pasa un instante real al día argentino", () => {
    // 03:00 UTC del 13 es 00:00 en Salta; 02:30 UTC del 13 sigue siendo el 12.
    expect(travelDayKey(null, new Date("2026-11-13T03:00:00Z"))).toBe("2026-11-13");
    expect(travelDayKey(null, new Date("2026-11-13T02:30:00Z"))).toBe("2026-11-12");
  });

  it("no inventa fecha cuando la reserva no tiene salida", () => {
    expect(travelDayKey(null, null)).toBeNull();
    expect(formatTravelDay(null)).toBe("-");
  });

  it("formatea el día para la tabla", () => {
    expect(formatTravelDay("2026-11-13")).toBe("13 nov 2026");
  });
});

describe("reservation search", () => {
  it("la búsqueda libre mira código, pasajero y ruta de una sola vez", () => {
    const where = adminReservationWhere({ q: "perez" }) as { AND: Array<{ OR: unknown[] }> };
    const texto = { contains: "perez", mode: "insensitive" };
    expect(where.AND[0].OR).toContainEqual({ code: texto });
    expect(where.AND[0].OR).toContainEqual(
      { passenger: { is: { OR: [
        { firstName: texto },
        { lastName: texto },
        { documentId: texto },
        { email: texto },
        { phone: texto }
      ] } } }
    );
    expect(where.AND[0].OR).toContainEqual({ route: { is: { OR: [{ from: texto }, { to: texto }, { slug: texto }] } } });
  });

  it("la búsqueda libre también encuentra por el código corto que se dicta por teléfono", () => {
    const where = adminReservationWhere({ q: "abcd-2345" }) as { AND: Array<{ OR: unknown[] }> };
    expect(where.AND[0].OR).toContainEqual({ shortCode: { contains: "ABCD2345", mode: "insensitive" } });
  });

  it("recorta la búsqueda antes de usarla", () => {
    const where = adminReservationWhere({ q: "  gomez  " }) as { AND: Array<{ OR: Array<{ code?: { contains: string } }> }> };
    expect(where.AND[0].OR[0].code?.contains).toBe("gomez");
  });

  it("el rango de fechas incluye el día hasta completo", () => {
    const where = adminReservationWhere({ date: "2026-11-03", until: "2026-11-05" }) as { AND: Array<{ OR: Array<Record<string, { is: Record<string, unknown> }>> }> };
    expect(where.AND[0].OR[0]).toEqual({
      schedule: { is: { departureAt: { gte: new Date("2026-11-03T03:00:00Z"), lt: new Date("2026-11-06T03:00:00Z") } } }
    });
  });

  it("las filas por página sólo aceptan los tamaños ofrecidos", () => {
    expect(adminReservationsPageSize({ pageSize: "100" })).toBe(100);
    expect(adminReservationsPageSize({ pageSize: "50" })).toBe(50);
    expect(adminReservationsPageSize({ pageSize: "7" })).toBe(ADMIN_RESERVATIONS_PAGE_SIZE);
    expect(adminReservationsPageSize({ pageSize: "cualquiera" })).toBe(ADMIN_RESERVATIONS_PAGE_SIZE);
    expect(adminReservationsPageSize({})).toBe(ADMIN_RESERVATIONS_PAGE_SIZE);
  });

  it("rejects invalid calendar days instead of silently searching all reservations", () => {
    expect(adminReservationFiltersSchema.safeParse({ date: "2026-02-30" }).success).toBe(false);
    expect(adminReservationFiltersSchema.safeParse({ date: "not-a-date" }).success).toBe(false);
  });
  it("combines filters and uses the travel day for all three booking modes", () => {
    const where = adminReservationWhere({ code: " arc-123 ", route: " SMA ", scheduleId: "departure", date: "2026-11-03" });
    expect(where.AND).toEqual([
      { OR: [
        { code: { contains: "arc-123", mode: "insensitive" } },
        { shortCode: { contains: "ARC123", mode: "insensitive" } }
      ] },
      { scheduleId: "departure" },
      expect.objectContaining({ OR: expect.any(Array) }),
      { OR: [
        { schedule: { is: { departureAt: { gte: new Date("2026-11-03T03:00:00Z"), lt: new Date("2026-11-04T03:00:00Z") } } } },
        { airportDetails: { is: { serviceDate: { gte: new Date("2026-11-03T03:00:00Z"), lt: new Date("2026-11-04T03:00:00Z") } } } },
        { chapelcoDetails: { is: { serviceDate: { gte: new Date("2026-11-03T00:00:00Z"), lt: new Date("2026-11-04T00:00:00Z") } } } }
      ] }
    ]);
  });
});

describe("vistas por día de viaje del listado (20-nov)", () => {
  // 20-nov 2026, 23:30 en Argentina: todavía es el 20 (no el 21 de UTC).
  const ahora = new Date("2026-11-21T02:30:00Z");

  it("«hoy» son los que viajan hoy en Argentina, sin las canceladas", () => {
    const where = adminReservationWhere({ vista: "hoy" }, [], ahora);
    expect(where.AND).toEqual([
      { status: { not: "CANCELLED" } },
      { OR: [
        { schedule: { is: { departureAt: { gte: new Date("2026-11-20T03:00:00Z"), lt: new Date("2026-11-21T03:00:00Z") } } } },
        { airportDetails: { is: { serviceDate: { gte: new Date("2026-11-20T03:00:00Z"), lt: new Date("2026-11-21T03:00:00Z") } } } },
        { chapelcoDetails: { is: { serviceDate: { gte: new Date("2026-11-20T00:00:00Z"), lt: new Date("2026-11-21T00:00:00Z") } } } }
      ] }
    ]);
  });

  it("«próximas» no tiene fin: de hoy en adelante", () => {
    const where = adminReservationWhere({ vista: "proximas" }, [], ahora) as { AND: Array<{ OR?: unknown[] }> };
    expect(where.AND[1].OR).toEqual([
      { schedule: { is: { departureAt: { gte: new Date("2026-11-20T03:00:00Z") } } } },
      { airportDetails: { is: { serviceDate: { gte: new Date("2026-11-20T03:00:00Z") } } } },
      { chapelcoDetails: { is: { serviceDate: { gte: new Date("2026-11-20T00:00:00Z") } } } }
    ]);
  });

  it("«todas» no filtra, y una vista desconocida tampoco rompe la página", () => {
    expect(adminReservationWhere({ vista: "todas" })).toEqual({});
    expect(adminReservationFiltersSchema.safeParse({ vista: "cualquiera" })).toMatchObject({ success: true, data: { vista: undefined } });
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

  it("el alta manual no ofrece el aeropuerto por salida horaria", () => {
    // Issue #79: el tramo San Martín ↔ Aeropuerto Chapelco se ofrecía con salidas 09:00/13:00/17:00
    // y la reserva quedaba sin número de vuelo. Se excluye por `bookingMode` de la ruta.
    expect(adminScheduleWhere({ excludeAirport: true })).toEqual({
      AND: [{ route: { is: { bookingMode: { not: "AIRPORT" } } } }]
    });
    expect(adminScheduleWhere({ bookableOnly: true, excludeAirport: true }, new Date("2026-11-05T15:00:00Z"))).toEqual({
      AND: [
        { route: { is: { bookingMode: { not: "AIRPORT" } } } },
        { status: { in: ["OPEN", "DOCUMENTATION"] } },
        { departureAt: { gte: new Date("2026-11-05T15:00:00Z") } },
        { route: { is: { isActive: true } } },
        { vehicle: { is: { isActive: true } } }
      ]
    });
  });

  it("la boletería oculta las rutas dadas de baja", () => {
    expect(adminScheduleWhere({ activeRoutesOnly: true })).toEqual({
      AND: [{ route: { is: { isActive: true } } }]
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
      AND: [
        {
          OR: [
            { code: { contains: "ARC", mode: "insensitive" } },
            { shortCode: { contains: "ARC", mode: "insensitive" } }
          ]
        }
      ]
    });
  });

  it("el buscador encuentra la reserva por el código corto, tipeado con o sin guiones", () => {
    for (const tipeado of ["ABCD-2345", "abcd 2345", "ABCD2345"]) {
      expect(adminReservationWhere({ code: tipeado })).toEqual({
        AND: [
          {
            OR: [
              { code: { contains: tipeado, mode: "insensitive" } },
              { shortCode: { contains: "ABCD2345", mode: "insensitive" } }
            ]
          }
        ]
      });
    }
  });

  it("sigue buscando por el código largo del link privado", () => {
    const largo = `ARC-2611-${"A".repeat(32)}`;
    expect(adminReservationWhere({ code: largo })).toEqual({
      AND: [
        {
          OR: [
            { code: { contains: largo, mode: "insensitive" } },
            { shortCode: { contains: largo.replace(/-/g, ""), mode: "insensitive" } }
          ]
        }
      ]
    });
  });

  it("un texto que no deja nada al normalizar no ensancha la búsqueda", () => {
    expect(adminReservationWhere({ code: "----" })).toEqual({
      AND: [{ OR: [{ code: { contains: "----", mode: "insensitive" } }] }]
    });
  });
});

describe("colas de cobro del listado", () => {
  it("pide todo pago pendiente de confirmar, con comprobante o sin él", () => {
    // La transferencia avisada por teléfono no tiene comprobante subido: igual entra en la cola
    // (19-nov: «validar un pago tiene que ser rápido y fácil para el admin»).
    expect(adminReservationWhere({ payment: "pending-payment" })).toEqual({
      AND: [
        { status: "PENDING_PAYMENT" },
        { payment: { is: { status: "PENDING", provider: "MANUAL" } } }
      ]
    });
  });

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
