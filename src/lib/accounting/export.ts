import ExcelJS from "exceljs";
import { buildExportSheets, type ExportCell, type ExportMeta } from "./export-rows";
import type { AccountingReport } from "./types";

const NUMBER_FORMATS: Record<string, string> = {
  money: '#,##0.00',
  date: "dd/mm/yyyy",
  int: "0",
  text: "@"
};

const HEADER_FILL = "FFE7DFCB";
const TEXT_COLOR = "FF233024";

function escribirCelda(cell: ExcelJS.Cell, origen: ExportCell) {
  cell.value = origen.v;

  if (origen.fmt) {
    cell.numFmt = NUMBER_FORMATS[origen.fmt];
  }

  // Los textos van como texto: una nota que empiece con "=" no debe volverse fórmula.
  if (origen.fmt === "text" || typeof origen.v === "string") {
    cell.numFmt = "@";
    cell.alignment = { vertical: "top", wrapText: false };
  }
}

/** Genera el .xlsx del reporte contable con las hojas Resumen, Ingresos, Gastos, Sueldos y Por nave. */
export async function buildAccountingWorkbook(report: AccountingReport, meta: ExportMeta): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "La Araucana Viajes";
  workbook.created = meta.generatedAt;
  workbook.modified = meta.generatedAt;

  for (const sheet of buildExportSheets(report, meta)) {
    const worksheet = workbook.addWorksheet(sheet.name, {
      views: [{ state: "frozen", ySplit: sheet.header ? 1 : 0 }],
      properties: { defaultRowHeight: 16 }
    });

    worksheet.columns = sheet.widths.map((width) => ({ width }));

    if (sheet.header) {
      const headerRow = worksheet.addRow(sheet.header);
      headerRow.font = { bold: true, color: { argb: TEXT_COLOR } };
      headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      headerRow.alignment = { vertical: "middle" };
      headerRow.height = 20;
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: sheet.header.length }
      };
    }

    for (const row of sheet.rows) {
      if (row.length === 0) {
        worksheet.addRow([]);
        continue;
      }

      const fila = worksheet.addRow(row.map((cell) => cell.v));

      row.forEach((origen, indice) => {
        const cell = fila.getCell(indice + 1);
        escribirCelda(cell, origen);

        if (sheet.rightColumns.includes(indice) && typeof origen.v === "number") {
          cell.alignment = { horizontal: "right", vertical: "top" };
        }
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return Buffer.from(buffer as ArrayBuffer);
}
