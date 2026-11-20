import { describe, expect, it } from "vitest";

import { salidasVigentes } from "./servicios-de-la-flota";

const desde = new Date("2026-11-20T03:00:00Z");
const hasta = new Date("2027-01-19T03:00:00Z");

describe("salidasVigentes", () => {
  it("sólo cuenta salidas de rutas activas", () => {
    expect(salidasVigentes(desde, hasta)).toMatchObject({ route: { isActive: true } });
  });

  it("deja afuera las canceladas", () => {
    expect(salidasVigentes(desde, hasta)).toMatchObject({ status: { not: "CANCELLED" } });
  });

  it("respeta la ventana pedida", () => {
    expect(salidasVigentes(desde, hasta)).toMatchObject({ departureAt: { gte: desde, lt: hasta } });
  });
});
