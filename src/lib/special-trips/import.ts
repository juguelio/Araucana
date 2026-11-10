import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { dateOnly, emptyLeg, parseMoney, type Leg, type PaymentInput } from "./data";

export const sourceSheets = ["Viajes especiales 2026", "Viajes especiales desde julio 2026", "Distrito"] as const;
const summarySheet = "Resumen año al 23-08-2026";
type Sheet = typeof sourceSheets[number];
export type SourceRow = { sheet: Sheet; row: number; original: string[] };
export type ImportSource = SourceRow & { id: string; issues: string[] };
export type ImportTrip = {
  client: string; serviceDate: Date; status: string; contact: string | null; passengers: number | null;
  legs: Leg[]; notes: string | null; currency: string; totalCents: number | null; billingMode: string;
  payments: PaymentInput[]; supplier: string | null; invoice: string | null; invoiceDate: Date | null;
  paymentStatus: string | null; sources: ImportSource[];
};

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sheetDate(raw: string) {
  const iso = dateOnly(raw);
  if (iso) return iso;
  const parts = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!parts) return null;
  const [, day, month, year] = parts;
  return dateOnly(`${year.length === 2 ? "20" + year : year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
}

function sourceDate(raw: string) {
  const date = sheetDate(raw);
  if (date) return { date, approximate: false };
  const range = raw.match(/^(\d{1,2})\s*(?:al|a|-)\s*\d{1,2}[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/i);
  const partial = raw.match(/^(\d{1,2})[/-](\d{1,2})$/);
  const inferred = range ? sheetDate(`${range[1]}/${range[2]}/${range[3] ?? "2026"}`)
    : partial ? sheetDate(`${partial[1]}/${partial[2]}/2026`) : null;
  return { date: inferred, approximate: !!inferred };
}

function amount(raw: string, max?: number) {
  const currency = /\b(?:usd|u\$s|d[oó]lares)\b|us\$/i.test(raw) ? "USD" : "ARS";
  const stripped = raw.replace(/(?:usd|u\$s|d[oó]lares|us\$|ars|\$)/gi, "").replace(/\s/g, "");
  const normalized = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(stripped)
    ? stripped.replaceAll(".", "").replace(",", ".")
    : stripped;
  return { currency, cents: parseMoney(normalized, max), explicit: currency === "USD" || /\$|ars/i.test(raw) };
}

function rowId(row: SourceRow) {
  return hash(`${row.sheet}\n${row.row}`);
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === "object" && "result" in value && value.result instanceof Date) return value.result.toISOString().slice(0, 10);
  return cell.text.trim();
}

export async function readWorkbook(file: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const rows: SourceRow[] = [];
  for (const sheet of sourceSheets) {
    const tab = workbook.getWorksheet(sheet) ?? workbook.getWorksheet(sheet.slice(0, 31));
    if (!tab) throw new Error(`Falta la pestaña «${sheet}». Descargá el libro completo desde Drive.`);
    tab.eachRow((row, number) => {
      if (number <= (sheet === "Distrito" ? 1 : 3)) return;
      const original = Array.from({ length: 9 }, (_, i) => cellText(row.getCell(i + 1)));
      if (original.some(Boolean)) rows.push({ sheet, row: number, original });
    });
  }
  if (rows.length > 2500) throw new Error("El libro tiene más filas de las admitidas para este historial.");
  const summary = workbook.getWorksheet(summarySheet);
  if (!summary) throw new Error(`Falta la pestaña «${summarySheet}».`);
  const expected = {
    count: Number(cellText(summary.getCell("B3"))),
    ars: amount(cellText(summary.getCell("B5")), Number.MAX_SAFE_INTEGER).cents,
    usd: amount(cellText(summary.getCell("B6")), Number.MAX_SAFE_INTEGER).cents
  };
  if (!expected.count || expected.ars === null || expected.usd === null) throw new Error("El resumen anual no tiene los valores de cotejo esperados.");
  return { rows, expected };
}

export function previewHistory(rows: SourceRow[], today: string) {
  const trips: ImportTrip[] = [];
  const skipped: ImportSource[] = [];
  const duplicates = new Map<string, ImportSource>();
  const totals = { count: 0, ars: 0, usd: 0 };
  let previous: ImportTrip | undefined;

  for (const row of rows) {
    const [rawDate, client, rawPassengers, description, contact, total, deposit, balance, notes] = row.original;
    const district = row.sheet === "Distrito";
    const source = { ...row, id: rowId(row), issues: [] as string[] };
    const { date, approximate } = sourceDate(rawDate);
    if (!date || (!description && !rawPassengers && !total) || /^(vacaciones|feriado|franco)\b/i.test(description)) {
      source.issues.push(!date ? "Fecha sin interpretar o fila de anotación." : "Posible anotación interna o fila incompleta.");
      skipped.push(source);
      previous = undefined;
      continue;
    }
    if (approximate) source.issues.push("Fecha aproximada: se usa el primer día de la referencia, sin crear ocupación.");
    if (!client) source.issues.push("Cliente sin identificar.");
    const count = Number(rawPassengers);
    const passengers = Number.isInteger(count) && count > 0 && count <= 100000 ? count : null;
    if (rawPassengers && passengers === null) source.issues.push("Cantidad de pasajeros sin interpretar.");
    const price = amount(total);
    const advance = amount(deposit);
    const pending = amount(balance);
    const account = /\b(?:cta\.?\s*cte\.?|cuenta corriente)\b/i.test(total + " " + (district ? "" : notes));
    const included = /\b(?:incluid[oa]|sin cargo|parte del paquete)\b/i.test(total + " " + description + " " + (district ? "" : notes));
    if (total && price.cents === null && !account && !included) source.issues.push("Total sin interpretar.");
    const currency = price.cents === null && advance.explicit && !district ? advance.currency : price.currency;
    const canImportAdvance = !district && !!advance.cents && (!advance.explicit || advance.currency === currency);
    if (!district && deposit && (advance.cents === null || (advance.explicit && advance.currency !== currency))) source.issues.push("Seña sin interpretar o en otra moneda.");
    if (!district && balance && (pending.cents === null || price.cents === null || pending.cents !== price.cents - (canImportAdvance ? advance.cents! : 0))) {
      source.issues.push("El saldo de la planilla difiere del saldo calculado.");
    }
    const country = /puc[oó]n|chile|temuco|villarrica|panguipulli|valdivia|osorno/i.test(description) ? "AR_CL" : "AR";
    const leg: Leg = { ...emptyLeg, country, description: description || client || "Servicio sin descripción", included };
    const day = date.toISOString().slice(0, 10);
    const fingerprint = row.original.map((cell) => cell.toLowerCase().replace(/\s+/g, " ").trim()).join("\u001f");
    const duplicate = duplicates.get(fingerprint);
    if (duplicate) {
      source.issues.push(`Posible duplicado de ${duplicate.sheet}, fila ${duplicate.row}. Se conserva para revisión.`);
    } else {
      duplicates.set(fingerprint, source);
    }

    if (!district && day >= "2026-01-01" && day <= "2026-08-23") {
      totals.count++;
      totals[currency === "USD" ? "usd" : "ars"] += price.cents ?? 0;
    }

    const anchor = previous?.sources[0];
    const group = previous && anchor?.sheet === row.sheet && !district && !duplicate &&
      client && previous.client.toLowerCase() === client.toLowerCase() && previous.passengers === passengers &&
      date >= previous.serviceDate && +date - +previous.serviceDate <= 7 * 86_400_000 &&
      !price.cents && !canImportAdvance && !account && (included || /^(?:regreso|vuelta)\b/i.test(description));

    if (group && previous) {
      previous.legs.push({ ...leg, included: true });
      previous.sources.push(source);
      continue;
    }
    if (!district && !included && !price.cents && /^(?:regreso|vuelta)\b/i.test(description)) source.issues.push("Regreso sin una ida identificada con certeza.");
    const invoiceDate = district ? sheetDate(balance) : null;
    if (district && balance && !invoiceDate) source.issues.push("Fecha de factura sin interpretar.");
    previous = {
      client: client || "Cliente sin identificar", serviceDate: date, status: day < today ? "COMPLETED" : "PENDING",
      contact: !district ? contact || null : null, passengers, legs: [leg],
      notes: !district ? notes || null : null, currency,
      totalCents: price.cents, billingMode: account ? "ACCOUNT" : price.cents !== null ? "FIXED" : included ? "INCLUDED" : "UNKNOWN",
      payments: canImportAdvance ? [{ date: "", amount: (advance.cents! / 100).toFixed(2), note: "Seña de planilla" }] : [],
      supplier: district ? contact || null : null, invoice: district ? deposit || null : null, invoiceDate,
      paymentStatus: district ? notes || null : null, sources: [source]
    };
    trips.push(previous);
  }
  return { trips, skipped, totals };
}

export function sourceVersion(source: ImportSource) {
  return hash(JSON.stringify(source.original));
}
