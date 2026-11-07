import { describe, expect, it } from "vitest";
import {
  INCOME_CRITERION,
  buildExportSheets,
  centsToAmount,
  exportFileName,
  totalsByCurrency,
  totalsByVehicleAndCurrency,
  type ExportMeta
} from "./export-rows";
import type { AccountingReport } from "./types";

const meta: ExportMeta = {
  periodLabel: "Noviembre 2026",
  from: new Date("2026-11-01T00:00:00.000Z"),
  to: new Date("2026-12-01T00:00:00.000Z"),
  vehicleName: null,
  generatedAt: new Date("2026-11-07T12:30:00.000Z")
};

function report(overrides: Partial<AccountingReport> = {}): AccountingReport {
  return {
    incomes: [
      {
        id: "r1",
        source: "reservation",
        code: "ARC-1",
        description: "ARC-1 · San Martin a Chapelco",
        amountCents: 1_500_000,
        currency: "ARS",
        occurredAt: new Date("2026-11-05T10:00:00.000Z"),
        vehicleId: "v1",
        vehicleName: "Araucana 24"
      },
      {
        id: "r2",
        source: "reservation",
        code: "ARC-2",
        description: "ARC-2 · Villa Traful a San Martin",
        amountCents: 100_000,
        currency: "USD",
        occurredAt: new Date("2026-11-06T10:00:00.000Z"),
        vehicleId: "v2",
        vehicleName: "Sprinter"
      }
    ],
    expenses: [
      {
        id: "e1",
        category: "FUEL",
        amountCents: 50_000,
        currency: "ARS",
        occurredAt: new Date("2026-11-04T10:00:00.000Z"),
        salaryPeriod: null,
        notes: "=SUMA(A1:A2)",
        vehicle: { id: "v1", name: "Araucana 24" },
        user: null
      },
      {
        id: "e2",
        category: "DRIVER_SALARY",
        amountCents: 800_000,
        currency: "ARS",
        occurredAt: new Date("2026-11-04T10:00:00.000Z"),
        salaryPeriod: "2026-10",
        notes: null,
        vehicle: null,
        user: { id: "u1", name: "Pacho", email: "pacho@araucana.test", role: "DRIVER" }
      }
    ],
    totals: { incomeCents: 1_600_000, expenseCents: 850_000, balanceCents: 750_000 },
    incomeByVehicle: [],
    expensesByVehicle: [],
    expensesByCategory: [],
    salariesByPerson: [],
    ...overrides
  };
}

describe("export contable: importes", () => {
  it("pasa centavos a importe con dos decimales", () => {
    expect(centsToAmount(1_234_567)).toBe(12_345.67);
    expect(centsToAmount(100)).toBe(1);
  });

  it("no suma monedas distintas en el mismo total", () => {
    const totales = totalsByCurrency(report());

    expect(totales.map((fila) => fila.currency)).toEqual(["ARS", "USD"]);
    expect(totales[0]).toMatchObject({ incomeCents: 1_500_000, expenseCents: 850_000, count: 3 });
    expect(totales[1]).toMatchObject({ incomeCents: 100_000, expenseCents: 0, count: 1 });
  });

  it("agrupa por nave sin mezclar monedas y sin perder gastos sin nave", () => {
    const filas = totalsByVehicleAndCurrency(report());

    expect(filas.map((fila) => `${fila.vehicle}/${fila.currency}`)).toEqual([
      "Araucana 24/ARS",
      "Sin nave asignada/ARS",
      "Sprinter/USD"
    ]);

    expect(filas[0]).toMatchObject({ incomeCents: 1_500_000, expenseCents: 50_000, movements: 2 });
    expect(filas[1]).toMatchObject({ incomeCents: 0, expenseCents: 800_000, movements: 1 });
  });
});

describe("export contable: hojas", () => {
  it("arma las cinco hojas en orden", () => {
    expect(buildExportSheets(report(), meta).map((sheet) => sheet.name)).toEqual([
      "Resumen",
      "Ingresos",
      "Gastos",
      "Sueldos",
      "Por nave"
    ]);
  });

  it("el resumen aclara el criterio de ingresos y avisa si hay varias monedas", () => {
    const resumen = buildExportSheets(report(), meta)[0];
    const textos = resumen.rows.flat().map((cell) => String(cell?.v ?? ""));

    expect(textos).toContain(INCOME_CRITERION);
    expect(textos.some((texto) => texto.startsWith("El período tiene 2 monedas"))).toBe(true);
    expect(textos).toContain("Noviembre 2026");
    expect(textos).toContain("Todas");
  });

  it("traduce la categoría y respeta el orden por fecha", () => {
    const gastos = buildExportSheets(report(), meta)[2];

    expect(gastos.header).toContain("Categoría");
    expect(gastos.rows.map((row) => row[1]?.v)).toEqual(["Nafta", "Sueldo chofer"]);
    expect(gastos.rows[0][4]).toEqual({ v: 500, fmt: "money" });
  });

  it("los importes viajan como número y las fechas como fecha", () => {
    const ingresos = buildExportSheets(report(), meta)[1];

    expect(ingresos.rows[0][0].v).toBeInstanceOf(Date);
    expect(ingresos.rows[0][4]).toEqual({ v: 15_000, fmt: "money" });
    expect(ingresos.rows[1][5]).toEqual({ v: "USD" });
  });

  it("agrupa los sueldos por persona con sus períodos", () => {
    const sueldos = buildExportSheets(report(), meta)[3];

    expect(sueldos.rows).toHaveLength(1);
    expect(sueldos.rows[0][0]).toEqual({ v: "Pacho" });
    expect(sueldos.rows[0][1]).toEqual({ v: 8_000, fmt: "money" });
    expect(sueldos.rows[0][3]).toEqual({ v: 1, fmt: "int" });
    expect(sueldos.rows[0][4]).toEqual({ v: "2026-10" });
  });

  it("un período vacío no rompe: totales en cero y hojas sin filas", () => {
    const vacio = buildExportSheets(
      report({ incomes: [], expenses: [], totals: { incomeCents: 0, expenseCents: 0, balanceCents: 0 } }),
      meta
    );

    expect(vacio[0].rows.flat().map((cell) => cell?.v)).toContain(0);
    expect(vacio[1].rows).toHaveLength(0);
    expect(vacio[3].rows).toHaveLength(0);
  });
});

describe("export contable: nombre del archivo", () => {
  it("saca acentos y espacios del período", () => {
    expect(exportFileName(meta)).toBe("araucana-contabilidad-noviembre-2026.xlsx");
  });

  it("agrega la nave cuando el reporte está filtrado", () => {
    expect(exportFileName({ ...meta, vehicleName: "Araucana 24" })).toBe(
      "araucana-contabilidad-noviembre-2026-araucana-24.xlsx"
    );
  });

  it("un rango de fechas no deja el nombre vacío", () => {
    expect(exportFileName({ ...meta, periodLabel: "2026-11-01 a 2026-11-15" })).toBe(
      "araucana-contabilidad-2026-11-01-a-2026-11-15.xlsx"
    );
  });
});
