import { describe, expect, it } from "vitest";
import { ORDER_RETURN_FIELD, orderReturnHref } from "./return-to-order";

const form = (value: string) => {
  const data = new FormData();
  data.set(ORDER_RETURN_FIELD, value);
  return data;
};

describe("volver a la orden de servicio después de asignar desde su modal", () => {
  it("vuelve a la misma orden (un vuelo, una nave o varios vuelos) con el aviso", () => {
    expect(orderReturnHref(form("date=2026-11-18&flight=f1&vehicle=a1"), "Listo."))
      .toBe("/admin/aeropuerto/orden-de-servicio/ver?date=2026-11-18&flight=f1&vehicle=a1&notice=Listo.");
    expect(orderReturnHref(form("date=2026-11-18&flights=f1%2Cf2"), "Listo."))
      .toBe("/admin/aeropuerto/orden-de-servicio/ver?date=2026-11-18&flights=f1%2Cf2&notice=Listo.");
  });

  it("no redirige con datos armados a mano", () => {
    expect(orderReturnHref(new FormData(), "x")).toBeNull();
    expect(orderReturnHref(form("date=mañana"), "x")).toBeNull();
    expect(orderReturnHref(form("date=2026-11-18&flight=//evil.com&next=https://evil.com"), "x"))
      .toBe("/admin/aeropuerto/orden-de-servicio/ver?date=2026-11-18&notice=x");
  });

  it.each(["vehicleId", "driverId"])("mantiene el filtro de equipo %s al guardar desde la orden", (key) => {
    expect(orderReturnHref(form(`date=2026-11-19&${key}=equipo-1`), "Listo."))
      .toBe(`/admin/aeropuerto/orden-de-servicio/ver?date=2026-11-19&${key}=equipo-1&notice=Listo.`);
    expect(orderReturnHref(form(`date=2026-11-19&${key}=`), "x")).toBeNull();
  });
});
