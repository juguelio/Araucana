import { fechaUTC, leerSemana, lunesDe, sumarDias } from "@/lib/school-runs/week";

export type CalendarCard = {
  id: string;
  href: string;
  title: string;
  kicker?: string;
  details: string[];
  status?: { label: string; tone?: "positive" | "warning" | "cancelled" };
};

export type CalendarWeek = {
  days: { date: string; cards: CalendarCard[]; href?: string }[];
  summary?: { label: string; value: number }[];
};

export const calendarWeekStart = (value: unknown) => {
  const date = leerSemana(value);
  return date ? lunesDe(date) : null;
};

export const calendarDayDistance = (first: string, last: string) =>
  (+fechaUTC(last)! - +fechaUTC(first)!) / 86_400_000;

export function calendarWindow(week: string) {
  return { start: sumarDias(week, -7), end: sumarDias(week, 7) };
}
