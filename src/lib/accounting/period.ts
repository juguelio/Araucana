import type { AccountingPeriod } from "./types";

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre"
];

export function createMonthPeriod(monthValue?: string): AccountingPeriod {
  const fallback = new Date();
  const match = monthValue?.match(/^(\d{4})-(\d{2})$/);
  const year = match ? Number(match[1]) : fallback.getUTCFullYear();
  const monthIndex = match ? Number(match[2]) - 1 : fallback.getUTCMonth();

  const from = new Date(Date.UTC(year, monthIndex, 1));
  const to = new Date(Date.UTC(year, monthIndex + 1, 1));

  return {
    from,
    to,
    label: `${MONTH_NAMES[monthIndex] ?? MONTH_NAMES[0]} ${year}`
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dateFromKey(value?: string) {
  const date = value ? new Date(`${value}T00:00:00.000Z`) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatShort(date: Date) {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

/** La semana empieza el lunes y termina el domingo, con fechas UTC como el resto de Contabilidad. */
export function createWeekPeriod(dayValue?: string): AccountingPeriod {
  const base = startOfUtcDay(dateFromKey(dayValue));
  const offset = (base.getUTCDay() + 6) % 7;
  const from = new Date(base.getTime() - offset * DAY_MS);
  const to = new Date(from.getTime() + 7 * DAY_MS);
  return {
    from,
    to,
    label: `Semana del ${formatShort(from)} al ${formatShort(new Date(to.getTime() - DAY_MS))}`
  };
}

export function createDayPeriod(dayValue?: string): AccountingPeriod {
  const from = startOfUtcDay(dateFromKey(dayValue));
  return {
    from,
    to: new Date(from.getTime() + DAY_MS),
    label: formatShort(from)
  };
}

export function createRangePeriod(fromValue?: string, toValue?: string): AccountingPeriod {
  if (!fromValue || !toValue) {
    return createMonthPeriod();
  }

  const from = new Date(`${fromValue}T00:00:00.000Z`);
  const rawTo = new Date(`${toValue}T00:00:00.000Z`);
  const to = new Date(rawTo.getTime() + 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(rawTo.getTime()) || from > rawTo) {
    return createMonthPeriod();
  }

  return {
    from,
    to,
    label: `${fromValue} a ${toValue}`
  };
}

export function isWithinPeriod(date: Date, period: AccountingPeriod) {
  return date >= period.from && date < period.to;
}
