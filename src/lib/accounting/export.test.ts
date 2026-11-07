import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildAccountingWorkbook } from "./export";
import { INCOME_CRITERION } from "./export-rows";
import type { AccountingReport } from "./types";

function report(): AccountingReport {
  return {
    incomes: [
      {
        id: "r1",
        source: "reservation",
        code: "ARC-2611-ABC",
        description: "ARC-2611-ABC · San Martin a Chapelco",
        amountCents: 1_500_000,
        currency: "ARS",
        occurredAt: new Date("2026-11-05T10:00:00.000Z"),
        vehicleId: "v1",
        vehicleName: "Araucana 24"
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
        // Una nota que arranca con "=" no debe salir como fórmula.
        notes: "=1+1 total",
        vehicle: { id: "v1", name: "Araucana 24" },
        user: null
      }
    ],
    totals: { incomeCents: 1_500_000, expenseCents: 50_000, balanceCents: 1_450_000 },
    incomeByVehicle: [],
    expensesByVehicle: [],
    expensesByCategory: [],
    salariesByPerson: []
  };
}

const meta = {
  periodLabel: "Noviembre 2026",
  from: new Date("2026-11-01T00:00:00.000Z"),
  to: new Date("2026-12-01T00:00:00.000Z"),
  vehicleName: null,
  generatedAt: new Date("2026-11-07T12:30:00.000Z")
};

async function cargar() {
  const buffer = await buildAccountingWorkbook(report(), meta);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return { buffer, workbook };
}

describe("workbook contable", () => {
  it("genera un xlsx legible por exceljs con las cinco hojas", async () => {
    const { buffer, workbook } = await cargar();

    expect(buffer.byteLength).toBeGreaterThan(4000);
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Resumen",
      "Ingresos",
      "Gastos",
      "Sueldos",
      "Por nave"
    ]);
  });

  it("encabezados congelados y con filtro en las hojas de detalle", async () => {
    const { workbook } = await cargar();
    const ingresos = workbook.getWorksheet("Ingresos");

    expect(ingresos?.getRow(1).values).toEqual([undefined, "Fecha", "Reserva", "Descripción", "Nave", "Importe", "Moneda"]);
    expect(ingresos?.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ingresos?.autoFilter).toBeTruthy();
  });

  it("los importes quedan como número y las fechas como fecha", async () => {
    const { workbook } = await cargar();
    const ingresos = workbook.getWorksheet("Ingresos");
    const fila = ingresos?.getRow(2);

    expect(typeof fila?.getCell(5).value).toBe("number");
    expect(fila?.getCell(5).value).toBe(15_000);
    expect(fila?.getCell(1).value).toBeInstanceOf(Date);
    expect(String(fila?.getCell(5).numFmt)).toContain("#,##0.00");
  });

  it("una nota que empieza con = sale como texto, no como fórmula", async () => {
    const { workbook } = await cargar();
    const gastos = workbook.getWorksheet("Gastos");
    const celda = gastos?.getRow(2).getCell(8);

    expect(celda?.value).toBe("=1+1 total");
    expect(celda?.formula).toBeUndefined();
  });

  it("el resumen lleva el criterio de ingresos", async () => {
    const { workbook } = await cargar();
    const resumen = workbook.getWorksheet("Resumen");

    const textos: string[] = [];
    resumen?.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === "string") textos.push(cell.value);
      });
    });

    expect(textos).toContain(INCOME_CRITERION);
  });
});
