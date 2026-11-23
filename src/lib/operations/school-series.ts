import { createHash } from "node:crypto";
import { dateOnly } from "@/lib/special-trips/data";
import { shiftDateKey } from "./day-board";

export function schoolDates(from: string, until: string, weekdays: string[], exceptions: string) {
  const start = dateOnly(from), end = dateOnly(until);
  if (!start || !end || end < start || +end - +start > 366 * 86400000) throw Error("Elegí un período de hasta un año.");
  if (!weekdays.length || weekdays.some(d => !/^[0-6]$/.test(d))) throw Error("Elegí al menos un día de la semana.");
  const skipped = exceptions.trim().split(/[\s,;]+/).filter(Boolean).map(d => d.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1"));
  if (skipped.some(d => !dateOnly(d) || d < from || d > until)) throw Error("Revisá las excepciones. Cada fecha debe estar dentro del período.");
  const result = [];
  for (let key = from; key <= until; key = shiftDateKey(key,1)) {
    if (weekdays.includes(String(new Date(key).getUTCDay())) && !skipped.includes(key)) result.push(key);
  }
  return result;
}

export function schoolOccurrenceId(base: string, date: string) {
  return "escolar-" + createHash("sha256").update(base + "/" + date).digest("hex");
}
