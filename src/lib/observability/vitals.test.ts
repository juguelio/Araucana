import { describe, expect, it } from "vitest";
import { rutaSinIds, webVitalSchema } from "./vitals";

describe("rutaSinIds", () => {
  it("nunca deja un código de reserva (es el enlace privado del pasajero)", () => {
    expect(rutaSinIds("/reservas/ARC-2611-A12A51B77BBEFD4589ABD2AABDCDCA14")).toBe("/reservas/:codigo");
    expect(rutaSinIds("/admin/reservas/ARC-2611-ABC?notice=ok")).toBe("/admin/reservas/:codigo");
  });
  it("cambia ids de panel y salidas, pero deja las altas y los slugs públicos", () => {
    expect(rutaSinIds("/admin/rutas/cmabc123/salidas/cmxyz789")).toBe("/admin/rutas/:id/salidas/:id");
    expect(rutaSinIds("/admin/rutas/cmabc123/salidas/nueva")).toBe("/admin/rutas/:id/salidas/nueva");
    expect(rutaSinIds("/admin/naves/nueva")).toBe("/admin/naves/nueva");
    expect(rutaSinIds("/reservar/aeropuerto-chapelco-sma")).toBe("/reservar/aeropuerto-chapelco-sma");
    expect(rutaSinIds("/chofer")).toBe("/chofer");
  });
});

describe("webVitalSchema", () => {
  it("acepta una métrica válida y rechaza nombres o valores raros", () => {
    expect(webVitalSchema.safeParse({ name: "LCP", value: 1234.5, rating: "good", route: "/" }).success).toBe(true);
    expect(webVitalSchema.safeParse({ name: "XSS", value: 1, route: "/" }).success).toBe(false);
    expect(webVitalSchema.safeParse({ name: "LCP", value: -1, route: "/" }).success).toBe(false);
  });
});
