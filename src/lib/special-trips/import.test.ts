import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { localDateTime } from "./data";
import { previewHistory, readWorkbook, sourceSheets, sourceVersion, type SourceRow } from "./import";

const sheet = sourceSheets[0];
function row(number: number, cells: string[], source: SourceRow["sheet"] = sheet): SourceRow {
  return { sheet: source, row: number, original: Array.from({ length: 9 }, (_, i) => cells[i] ?? "") };
}

describe("historial de viajes especiales", () => {
  it("reconoce la pestaña truncada de Excel y los totales grandes del resumen", async () => {
    const workbook = new ExcelJS.Workbook();
    for (const name of sourceSheets) workbook.addWorksheet(name.slice(0, 31));
    const summary = workbook.addWorksheet("Resumen año al 23-08-2026");
    summary.getCell("B3").value = 204;
    summary.getCell("B5").value = "$122.552.000";
    summary.getCell("B6").value = 3330;
    workbook.worksheets[1].getRow(5).values = ["02/07/2026", "Grupo", "8", "San Martín a Pucón"];
    const input = await readWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(input.expected).toEqual({ count: 204, ars: 12_255_200_000, usd: 333_000 });
    expect(input.rows[0]).toMatchObject({ sheet: sourceSheets[1], row: 5 });
  });

  it("agrupa un regreso identificado sin duplicar el importe ni la seña y conserva las filas", () => {
    const input = [
      row(5, ["21/02/2026", "Grupo", "12", "San Martín a Pucón", "", "USD 500", "200", "300"]),
      row(7, ["24/02/2026", "Grupo", "12", "Regreso de Pucón", "", "$0"]),
      row(9, ["", "", "", "Nota interna"])
    ];
    const result = previewHistory(input, "2026-11-10");
    expect(result.trips).toHaveLength(1);
    expect(result.trips[0]).toMatchObject({ totalCents: 50_000, currency: "USD", payments: [{ amount: "200.00" }] });
    expect(result.trips[0].legs.map((leg) => leg.included)).toEqual([false, true]);
    expect(result.totals).toEqual({ count: 2, ars: 0, usd: 50_000 });
    expect(result.skipped[0].row).toBe(9);
    expect(sourceVersion(result.trips[0].sources[0])).toEqual(sourceVersion(previewHistory(input, "2026-11-10").trips[0].sources[0]));
  });

  it("mantiene facturación de Distrito y una fecha de rango como aproximada", () => {
    const input = [
      row(4, ["24/08/2026", "Distrito", "12", "Viaje", "Proveedor", "$600.000,00", "F-001", "30/08/2026", "Cobrado"], "Distrito"),
      row(25, ["17 al 22/10", "Grupo", "20", "Pucón", "", "cta cte"])
    ];
    const result = previewHistory(input, "2026-11-10");
    expect(result.trips[0]).toMatchObject({ supplier: "Proveedor", invoice: "F-001", invoiceDate: new Date("2026-08-30"), paymentStatus: "Cobrado", payments: [] });
    expect(result.trips[1]).toMatchObject({ serviceDate: new Date("2026-10-17"), billingMode: "ACCOUNT", totalCents: null });
    expect(result.trips[1].sources[0].issues).toContain("Fecha aproximada: se usa el primer día de la referencia, sin crear ocupación.");
  });
});

describe("horario operativo", () => {
  it("convierte una ocupación que termina al día siguiente", () => {
    expect(localDateTime("2026-11-10T20:00", "America/Argentina/Salta")).toEqual(new Date("2026-11-10T23:00Z"));
    expect(localDateTime("2026-11-11T03:00", "America/Argentina/Salta")).toEqual(new Date("2026-11-11T06:00Z"));
  });

  it("aplica el horario de invierno de Santiago y rechaza horas inexistentes", () => {
    expect(localDateTime("2026-07-10T08:30", "America/Santiago")).toEqual(new Date("2026-07-10T12:30Z"));
    expect(localDateTime("2026-09-06T00:30", "America/Santiago")).toBeNull();
  });
});
