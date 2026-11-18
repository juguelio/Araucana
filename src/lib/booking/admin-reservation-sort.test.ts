import { describe, expect, it } from "vitest";
import { adminReservationOrder, adminReservationOrderBy } from "./admin-reservation-sort";

describe("orden del listado de reservas", () => {
  it("sin `?orden=` mantiene el orden de siempre: alta más reciente arriba", () => {
    expect(adminReservationOrder({})).toEqual({ columna: "alta", direccion: "desc" });
    expect(adminReservationOrderBy({})).toEqual([{ createdAt: "desc" }, { code: "asc" }]);
  });

  it("una columna que no está en la lista blanca cae al orden por defecto", () => {
    expect(adminReservationOrder({ orden: "passwordHash" })).toEqual({ columna: "alta", direccion: "desc" });
    expect(adminReservationOrderBy({ orden: "salaryCents", dir: "asc" })).toEqual([{ createdAt: "desc" }, { code: "asc" }]);
  });

  it("mapea cada columna visible a su campo, con el código como desempate estable", () => {
    expect(adminReservationOrderBy({ orden: "codigo", dir: "asc" })).toEqual([{ code: "asc" }]);
    expect(adminReservationOrderBy({ orden: "pasajero", dir: "desc" })).toEqual([
      { passenger: { firstName: "desc" } },
      { passenger: { lastName: "desc" } },
      { code: "asc" }
    ]);
    expect(adminReservationOrderBy({ orden: "creadaPor", dir: "asc" })).toEqual([{ createdByName: "asc" }, { code: "asc" }]);
    expect(adminReservationOrderBy({ orden: "asiento", dir: "desc" })).toEqual([{ seatNumber: "desc" }, { code: "asc" }]);
    expect(adminReservationOrderBy({ orden: "estado", dir: "asc" })).toEqual([{ status: "asc" }, { code: "asc" }]);
    expect(adminReservationOrderBy({ orden: "pago", dir: "desc" })).toEqual([{ payment: { status: "desc" } }, { code: "asc" }]);
  });

  it("una dirección que no se entiende ordena ascendente por la columna pedida", () => {
    expect(adminReservationOrder({ orden: "pasajero", dir: "arriba" })).toEqual({ columna: "pasajero", direccion: "asc" });
  });
});
