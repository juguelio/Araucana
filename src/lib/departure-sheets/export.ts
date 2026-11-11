import ExcelJS from "exceljs";
import {
  departureSheetColumns,
  departureSheetCopy,
  isDepartureSheetKind,
  type DepartureSheetColumn,
  type DepartureSheetPassengerRow
} from "./types";

export type DepartureSheetExportMeta = {
  kind: string;
  title: string;
  destination?: string | null;
  departureAt?: Date | null;
  borderCrossing?: string | null;
  notes?: string | null;
};

const HEADER_FILL = "FFE7DFCB";
const TEXT_COLOR = "FF233024";
const NUMBER_FORMATS: Record<DepartureSheetColumn["format"], string> = {
  text: "@",
  date: "dd/mm/yyyy",
  int: "0"
};

const WIDTHS: Record<string, number[]> = {
  DUT: [22, 22, 16, 20, 8, 14, 20],
  PROVINCIA: [6, 34, 14, 18, 22, 8, 24, 20]
};

/**
 * Filas de la planilla, con los encabezados tal cual los usa el cliente. Se exporta aparte del
 * .xlsx para poder testear el contenido sin pasar por exceljs.
 */
export function buildDepartureSheetRows(kind: string, passengers: DepartureSheetPassengerRow[]) {
  const columns = departureSheetColumns(kind);
  const ordered = [...passengers].sort((a, b) => a.position - b.position);

  return {
    header: columns.map((column) => column.header),
    rows: ordered.map((passenger) => columns.map((column) => column.value(passenger))),
    widths: WIDTHS[kind] ?? columns.map(() => 20)
  };
}

export function departureSheetFileBase(meta: DepartureSheetExportMeta) {
  const kind = isDepartureSheetKind(meta.kind) ? departureSheetCopy[meta.kind].shortLabel : "Planilla";
  const date = meta.departureAt ? meta.departureAt.toISOString().slice(0, 10) : null;
  const slug = [kind, date ?? meta.title]
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return `planilla-${slug}`;
}

/** Genera el .xlsx que reemplaza la planilla en blanco que mandó el cliente. */
export async function buildDepartureSheetWorkbook(
  meta: DepartureSheetExportMeta,
  passengers: DepartureSheetPassengerRow[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "La Araucana Viajes";
  workbook.created = new Date();
  workbook.modified = new Date();

  const columns = departureSheetColumns(meta.kind);
  const rows = buildDepartureSheetRows(meta.kind, passengers);
  const name = isDepartureSheetKind(meta.kind) ? departureSheetCopy[meta.kind].worksheetName : "Planilla";
  const worksheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }]
  });

  worksheet.columns = rows.widths.map((width) => ({ width }));

  const headerRow = worksheet.addRow(rows.header);
  headerRow.font = { bold: true, color: { argb: TEXT_COLOR } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  headerRow.alignment = { vertical: "middle" };
  headerRow.height = 20;
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: Math.max(1, rows.header.length) }
  };

  for (const row of rows.rows) {
    const excelRow = worksheet.addRow(row);

    row.forEach((value, index) => {
      const cell = excelRow.getCell(index + 1);
      const format = columns[index]?.format ?? "text";
      cell.value = value;
      cell.numFmt = NUMBER_FORMATS[format];
      cell.alignment = format === "int" ? { horizontal: "right" } : { vertical: "top" };
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return Buffer.from(buffer as ArrayBuffer);
}
