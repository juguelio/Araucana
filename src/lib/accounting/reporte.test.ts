import { describe, expect, it } from "vitest";
import { createMonthPeriod, createRangePeriod } from "./period";
import { conParte, periodoAnterior, resultadoPorNave, rutasQueMasFacturan, textoDeVariacion, totalesPorMoneda, variacion } from "./reporte";

const egreso = (amountCents: number, vehicle: { id: string; name: string } | null, currency = "ARS") =>
  ({ amountCents, currency, vehicle }) as never;

describe("resultadoPorNave", () => {
  const filas = resultadoPorNave({
    incomeByVehicle: [
      { id: "sin-nave", label: "Sin nave asignada", amountCents: 500, currency: "ARS" },
      { id: "bus", label: "Bus 243", amountCents: 1000, currency: "ARS" },
      { id: "spr", label: "Sprinter 196", amountCents: 300, currency: "ARS" },
      { id: "bus", label: "Bus 243", amountCents: 50, currency: "USD" }
    ],
    expensesByVehicle: [
      { id: "bus", label: "Bus 243", amountCents: 200, currency: "ARS" },
      { id: "ama", label: "Amarok", amountCents: 100, currency: "ARS" }
    ],
    expenses: [egreso(200, { id: "bus", name: "Bus 243" }), egreso(100, { id: "ama", name: "Amarok" }), egreso(700, null), egreso(40, null)]
  });

  it("junta ingresos y gastos de cada nave, por moneda", () => {
    expect(filas.find((f) => f.id === "bus" && f.moneda === "ARS")).toMatchObject({ ingresosCents: 1000, gastosCents: 200, resultadoCents: 800, margen: 80 });
    expect(filas.find((f) => f.id === "ama")).toMatchObject({ ingresosCents: 0, gastosCents: 100, resultadoCents: -100, margen: null });
    expect(filas.find((f) => f.id === "bus" && f.moneda === "USD")).toMatchObject({ ingresosCents: 50, gastosCents: 0 });
  });

  it("las naves primero (mejor resultado arriba), después sin nave y gastos generales", () => {
    expect(filas.map((f) => `${f.id}:${f.moneda}`)).toEqual(["bus:ARS", "spr:ARS", "ama:ARS", "bus:USD", "sin-nave:ARS", "gastos-generales:ARS"]);
    expect(filas.at(-1)).toMatchObject({ nave: "Gastos generales (sin nave)", gastosCents: 740 });
  });

  it("los totales cierran con ingresos y egresos del período", () => {
    expect(totalesPorMoneda(filas)).toEqual([
      { moneda: "ARS", ingresosCents: 1800, gastosCents: 1040, resultadoCents: 760, margen: 42.2 },
      { moneda: "USD", ingresosCents: 50, gastosCents: 0, resultadoCents: 50, margen: 100 }
    ]);
  });
});

describe("periodoAnterior", () => {
  it("de un mes, el mes anterior (cruzando el año)", () => {
    expect(periodoAnterior(createMonthPeriod("2026-11"))).toMatchObject({ label: "Octubre 2026", nombre: "octubre" });
    const enero = periodoAnterior(createMonthPeriod("2027-01"));
    expect(enero.from.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(enero.to.toISOString().slice(0, 10)).toBe("2027-01-01");
  });

  it("de un rango, los mismos días inmediatamente antes", () => {
    const anterior = periodoAnterior(createRangePeriod("2026-11-10", "2026-11-16"));
    expect(anterior.from.toISOString().slice(0, 10)).toBe("2026-11-03");
    expect(anterior.to.toISOString().slice(0, 10)).toBe("2026-11-10");
    expect(anterior.nombre).toBe("los 7 días anteriores");
  });

  it("un rango que cubre el mes entero compara contra la misma cantidad de días, no contra el mes anterior", () => {
    const anterior = periodoAnterior(createRangePeriod("2026-11-01", "2026-11-30"), false);
    expect(anterior.from.toISOString().slice(0, 10)).toBe("2026-10-02");
    expect(anterior.to.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(anterior.nombre).toBe("los 30 días anteriores");
  });
});

describe("variación", () => {
  it("porcentaje redondeado; sin base, null", () => {
    expect(variacion(1200, 1000)).toBe(20);
    expect(variacion(500, 1000)).toBe(-50);
    expect(variacion(500, 0)).toBeNull();
    expect(variacion(-50, -100)).toBe(50);
  });

  it("el texto de la cifra", () => {
    const f = (cents: number) => `$ ${cents}`;
    expect(textoDeVariacion(1200, 1000, "octubre", f)).toBe("octubre: $ 1000 (+20 %)");
    expect(textoDeVariacion(800, 1000, "octubre", f)).toBe("octubre: $ 1000 (−20 %)");
    expect(textoDeVariacion(1000, 1000, "octubre", f)).toBe("octubre: $ 1000 (igual)");
    expect(textoDeVariacion(400000, 100, "octubre", f)).toBe("octubre: $ 100");
    expect(textoDeVariacion(-500, -1000, "octubre", f)).toBe("octubre: $ -1000 (+50 %)");
    expect(textoDeVariacion(1000, 0, "octubre", f)).toBe("sin datos en octubre");
    expect(textoDeVariacion(0, 0, "octubre", f)).toBeNull();
  });
});

describe("rutas y partes", () => {
  const ingreso = (routeFrom: string, routeTo: string, amountCents: number, currency = "ARS") => ({ routeFrom, routeTo, amountCents, currency });

  it("agrupa por ruta corta y moneda, las que más facturan primero", () => {
    expect(rutasQueMasFacturan([
      ingreso("San Martín de los Andes", "Villa Traful", 100),
      ingreso("Aeropuerto Chapelco", "San Martín de los Andes", 300),
      ingreso("San Martín de los Andes", "Villa Traful", 150),
      ingreso("San Martín de los Andes", "Villa Traful", 10, "USD")
    ], 2)).toEqual([
      { ruta: "Aerop. Chapelco → San Martín", moneda: "ARS", reservas: 1, ingresosCents: 300 },
      { ruta: "San Martín → Villa Traful", moneda: "ARS", reservas: 2, ingresosCents: 250 },
      { ruta: "San Martín → Villa Traful", moneda: "USD", reservas: 1, ingresosCents: 10 }
    ]);
  });

  it("corta por moneda y no pierde una ruta en USD detrás de muchas en ARS", () => {
    const ingresos = Array.from({ length: 8 }, (_, i) => ingreso(`Ruta ${i}`, "Destino", (i + 1) * 1000));
    ingresos.push(ingreso("Ruta USD", "Destino", 50, "USD"));
    const rutas = rutasQueMasFacturan(ingresos, 2);
    expect(rutas.map((r) => `${r.moneda}:${r.ruta}`)).toEqual([
      "ARS:Ruta 7 → Destino",
      "ARS:Ruta 6 → Destino",
      "USD:Ruta USD → Destino"
    ]);
  });

  it("la parte de cada grupo es sobre el total de su moneda", () => {
    expect(conParte([
      { amountCents: 750, currency: "ARS" },
      { amountCents: 250, currency: "ARS" },
      { amountCents: 10, currency: "USD" }
    ]).map((g) => g.parte)).toEqual([75, 25, 100]);
  });
});
