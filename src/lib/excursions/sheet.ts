import ExcelJS from "exceljs";
import {
  documentoDelPasajero,
  fechaDeLaOrden,
  horaEnSalta,
  paymentLabel,
  plata
} from "@/lib/airport/service-order";

/**
 * Planilla de excursiones (issue #110).
 *
 * El pedido del cliente fue explícito: «la planilla que salga también va a tener que estar aclarado en
 * caso de que eso venga de otra agencia». La forma es la misma que la orden de servicio del chofer:
 * un bloque por excursión del día, las mismas columnas de pasajero y **«Derivado por»** en su columna.
 */

export type ExcursionSheetPassenger = {
  code: string;
  name: string;
  seats: number;
  document: string;
  /** Quién derivó la venta; `null` cuando se vendió directo. */
  referredBy: string | null;
  payment: string;
  amountCents: number;
  currency: string;
  contact: string;
};

export type ExcursionSheetBlock = {
  key: string;
  excursionId: string;
  excursionName: string;
  duration: string;
  departureAt: Date;
  passengers: ExcursionSheetPassenger[];
  totalCents: number;
};

/** Lo que necesita la planilla de cada venta: sale del repositorio ya resuelto. */
export type ExcursionSheetBookingInput = {
  code: string;
  excursionId: string;
  excursionName: string;
  duration: string;
  departureAt: Date;
  passengerCount: number;
  totalCents: number;
  currency: string;
  status: string;
  referredBy: string | null;
  passenger: {
    firstName: string;
    lastName: string;
    documentType: string;
    documentId: string;
    phone: string;
    email: string;
  };
};

export const EXCURSION_SHEET_COLUMNS = ["Pasajero", "Cant", "DNI", "Derivado por", "Pago", "Contacto"];

/** Una celda por columna, en el mismo orden que `EXCURSION_SHEET_COLUMNS`. */
export function excursionSheetRow(passenger: ExcursionSheetPassenger): string[] {
  return [
    passenger.name,
    String(passenger.seats),
    passenger.document,
    passenger.referredBy ?? "",
    passenger.payment,
    passenger.contact
  ];
}

/**
 * Agrupa las ventas por excursión y horario de salida, en el orden del día. Una excursión sin ventas
 * no genera bloque: la planilla no inventa renglones.
 */
export function buildExcursionSheetBlocks(bookings: ExcursionSheetBookingInput[]): ExcursionSheetBlock[] {
  const porBloque = new Map<string, ExcursionSheetBlock>();

  for (const booking of bookings) {
    const key = `${booking.excursionId}-${booking.departureAt.toISOString()}`;
    let block = porBloque.get(key);
    if (!block) {
      block = {
        key,
        excursionId: booking.excursionId,
        excursionName: booking.excursionName,
        duration: booking.duration,
        departureAt: booking.departureAt,
        passengers: [],
        totalCents: 0
      };
      porBloque.set(key, block);
    }

    block.passengers.push({
      code: booking.code,
      name: `${booking.passenger.firstName} ${booking.passenger.lastName}`.trim(),
      seats: booking.passengerCount,
      document: documentoDelPasajero(booking.passenger.documentType, booking.passenger.documentId),
      referredBy: booking.referredBy?.trim() ? booking.referredBy.trim() : null,
      payment: paymentLabel(booking.status, booking.totalCents, booking.currency),
      amountCents: booking.totalCents,
      currency: booking.currency,
      contact: booking.passenger.phone || booking.passenger.email
    });
    block.totalCents += booking.totalCents;
  }

  const blocks = [...porBloque.values()];
  for (const block of blocks) {
    block.passengers.sort((a, b) => a.name.localeCompare(b.name, "es"));
  }
  return blocks.sort((a, b) => a.departureAt.getTime() - b.departureAt.getTime() || a.excursionName.localeCompare(b.excursionName, "es"));
}

export function excursionBlockLabel(block: ExcursionSheetBlock) {
  const detalle = block.duration.trim() ? ` · ${block.duration.trim()}` : "";
  return `${horaEnSalta(block.departureAt)} · ${block.excursionName}${detalle}`;
}

const ANCHOS = [34, 6, 16, 24, 18, 26];

export function excursionSheetFileName(date: string) {
  return `planilla-excursiones-${date}.xlsx`;
}

/**
 * El .xlsx de la planilla, con la estructura del papel: una banda por bloque y una fila por venta.
 * Mismas columnas que la pantalla y que el link del guía.
 */
export async function buildExcursionSheetWorkbook(
  meta: { date: string; generatedAt: Date },
  blocks: ExcursionSheetBlock[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "La Araucana Viajes";
  workbook.created = meta.generatedAt;
  workbook.modified = meta.generatedAt;

  const sheet = workbook.addWorksheet("Planilla de excursiones", {
    views: [{ state: "frozen", ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  sheet.columns = ANCHOS.map((width) => ({ width }));

  sheet.mergeCells("A1:F3");
  const titulo = sheet.getCell("A1");
  titulo.value = "La Araucana viajes S.R.L.";
  titulo.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  titulo.alignment = { vertical: "middle" };
  for (let fila = 1; fila <= 3; fila += 1) {
    for (let columna = 1; columna <= 6; columna += 1) {
      sheet.getCell(fila, columna).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B4F3F" } };
    }
  }

  sheet.mergeCells("A4:F4");
  const subtitulo = sheet.getCell("A4");
  subtitulo.value = `PLANILLA DE EXCURSIONES · ${fechaDeLaOrden(meta.date)}`;
  subtitulo.font = { bold: true, size: 12 };
  subtitulo.alignment = { vertical: "middle" };

  let fila = 6;
  const totalPasajeros = blocks.reduce((suma, bloque) => suma + bloque.passengers.reduce((n, p) => n + p.seats, 0), 0);
  const totalDelDia = blocks.reduce((suma, bloque) => suma + bloque.totalCents, 0);
  const currency = blocks[0]?.passengers[0]?.currency ?? "ARS";

  if (blocks.length === 0) {
    sheet.getCell(fila, 1).value = "No hay ventas de excursiones para ese día.";
    fila += 1;
  }

  for (const bloque of blocks) {
    sheet.mergeCells(`A${fila}:F${fila}`);
    const banda = sheet.getCell(fila, 1);
    banda.value = excursionBlockLabel(bloque);
    banda.font = { bold: true, size: 11, color: { argb: "FF0B4F3F" } };
    for (let columna = 1; columna <= 6; columna += 1) {
      sheet.getCell(fila, columna).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0EC" } };
    }
    fila += 1;

    const encabezado = sheet.getRow(fila);
    EXCURSION_SHEET_COLUMNS.forEach((columna, indice) => {
      const celda = encabezado.getCell(indice + 1);
      celda.value = columna;
      celda.font = { bold: true, size: 9 };
    });
    fila += 1;

    for (const pasajero of bloque.passengers) {
      const filaDatos = sheet.getRow(fila);
      excursionSheetRow(pasajero).forEach((valor, indice) => {
        filaDatos.getCell(indice + 1).value = valor;
      });
      fila += 1;
    }

    const total = sheet.getRow(fila);
    total.getCell(1).value = `Total ${bloque.excursionName}`;
    total.getCell(1).font = { bold: true };
    total.getCell(5).value = plata(bloque.totalCents, currency);
    total.getCell(5).font = { bold: true };
    fila += 2;
  }

  if (blocks.length > 0) {
    const resumen = sheet.getRow(fila);
    resumen.getCell(1).value = `${totalPasajeros} pasajero(s) · ${blocks.length} salida(s)`;
    resumen.getCell(5).value = `TOTAL DEL DÍA ${plata(totalDelDia, currency)}`;
    resumen.getCell(5).font = { bold: true };
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
