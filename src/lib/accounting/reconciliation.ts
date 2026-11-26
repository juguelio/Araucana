export type BankRow = { date: string; reference: string; cents: number; currency: string };
export type LedgerPayment = BankRow & { code: string };
export type CheckRow = { status: string; bank?: BankRow; payment?: LedgerPayment };

export const statementHeader = ["Fecha", "Referencia", "Importe", "Moneda"];
const key = (reference: string) => reference.trim().toUpperCase();

function bankDate(value: unknown) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  const date = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const iso = date ? date[3] + "-" + date[2] + "-" + date[1] : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const parsed = new Date(iso + "T00:00:00Z");
  return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : "";
}

function amount(value: unknown) {
  if (typeof value === "number") {
    const n = Math.round(value * 100);
    return Number.isSafeInteger(n) && Math.abs(value - n / 100) < 0.0000001 ? n : NaN;
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text)) return NaN;
  const [integer, decimal = ""] = text.replace(/[+.\-]/g, "").split(",");
  const n = Number(integer + decimal.padEnd(2, "0"));
  return Number.isSafeInteger(n) ? (text.startsWith("-") ? -n : n) : NaN;
}

export function readStatement(rows: unknown[][], month: string): BankRow[] {
  const [head, ...data] = rows;
  if (!head || statementHeader.some((h, i) => key(String(head[i] ?? "")) !== key(h)))
    throw Error("La primera fila debe contener Fecha, Referencia, Importe y Moneda, en ese orden.");
  const result: BankRow[] = [];
  for (const [index, row] of data.entries()) {
    if (!row.some((v) => v != null && v !== "")) continue;
    const line = "Fila " + (index + 2) + ": ";
    const date = bankDate(row[0]);
    if (!date || date.slice(0, 7) !== month) throw Error(line + "revisá la fecha y el mes seleccionado.");
    const cents = amount(row[2]);
    if (!Number.isSafeInteger(cents))
      throw Error(line + "usá una celda numérica o un importe como 1.234,56.");
    const currency = key(String(row[3] ?? ""));
    if (!/^[A-Z]{3}$/.test(currency)) throw Error(line + "indicá una moneda de tres letras.");
    if (
      row[1] != null &&
      typeof row[1] !== "string" &&
      !(typeof row[1] === "number" && Number.isSafeInteger(row[1]))
    )
      throw Error(line + "usá texto para la referencia.");
    result.push({ date, reference: String(row[1] ?? "").trim(), cents, currency });
  }
  if (!result.length) throw Error("El extracto está vacío.");
  return result;
}

/** Un pago y un crédito deben identificarse mutuamente antes de proponer una coincidencia. */
export function compareStatement(bank: BankRow[], payments: LedgerPayment[]): CheckRow[] {
  const byRef = new Map<string, LedgerPayment[]>();
  for (const p of payments)
    for (const ref of new Set([key(p.reference), key(p.code)])) {
      if (!ref) continue;
      const list = byRef.get(ref);
      if (list) list.push(p);
      else byRef.set(ref, [p]);
    }
  const candidates = bank.map((b) => (b.cents > 0 ? (byRef.get(key(b.reference)) ?? []) : []));
  const uses = new Map<LedgerPayment, number>();
  for (const list of candidates) for (const p of list) uses.set(p, (uses.get(p) ?? 0) + 1);
  const paired = new Set<LedgerPayment>();
  const result: CheckRow[] = bank.map((b, i) => {
    const list = candidates[i];
    if (b.cents <= 0) return { status: "Débito o ajuste", bank: b };
    if (!list.length) return { status: "Sin pago identificado", bank: b };
    const p = list[0];
    if (list.length > 1 || uses.get(p)! > 1) return { status: "Referencia ambigua", bank: b };
    paired.add(p);
    const status =
      p.currency !== b.currency
        ? "Revisar moneda"
        : p.cents !== b.cents
          ? "Revisar importe"
          : "Coincidencia exacta";
    return { status, bank: b, payment: p };
  });
  for (const p of payments)
    if (!paired.has(p))
      result.push({
        status: uses.has(p) ? "Pago con referencia ambigua" : "Pago sin acreditar en el extracto",
        payment: p,
      });
  return result;
}

/** Las filas ambiguas conservan los dos lados por separado. Cada movimiento se cuenta una vez. */
export function currencySummary(rows: CheckRow[]) {
  const groups = new Map<string, { currency: string; credits: number; debits: number; approved: number }>();
  function group(currency: string) {
    const total = groups.get(currency) ?? { currency, credits: 0, debits: 0, approved: 0 };
    groups.set(currency, total);
    return total;
  }
  for (const { bank, payment } of rows) {
    if (bank && bank.cents > 0) group(bank.currency).credits += bank.cents;
    if (bank && bank.cents <= 0) group(bank.currency).debits -= bank.cents;
    if (payment) group(payment.currency).approved += payment.cents;
  }
  return [...groups.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
