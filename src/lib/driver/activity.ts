import { dayRange, localDateKey, type BoardArea } from "@/lib/operations/day-board";

export const driverActivityAreas: Record<BoardArea, string> = {
  RUTA: "Rutas",
  AEROPUERTO: "Aeropuerto",
  CHAPELCO: "Chapelco",
  ESPECIAL: "Viajes especiales"
};

export const driverActivityPeriods = {
  hoy: "Hoy y en curso",
  proximas: "Próximas",
  historial: "Historial"
};

export type DriverActivityPeriod = keyof typeof driverActivityPeriods;

export type DriverActivity = {
  id: string;
  area: BoardArea;
  date: string;
  startsAt: Date | null;
  endsAt: Date | null;
  title: string;
  vehicle: string;
  status?: string;
  links: { href: string; label: string; adminOnly?: boolean }[];
};

export function activityPeriod(entry: DriverActivity, today: string): DriverActivityPeriod {
  if (entry.date > today) return "proximas";
  if (entry.date === today || (!entry.status && entry.endsAt && entry.endsAt > dayRange(today).from)) return "hoy";
  return "historial";
}

export function activityStatus(entry: DriverActivity, now: Date): string {
  if (entry.status) return entry.status;
  if (entry.endsAt && entry.endsAt <= now) return "Horario finalizado";
  if (entry.startsAt && entry.endsAt && entry.startsAt <= now) return "En horario de servicio";
  return entry.date < localDateKey(now) ? "Fecha pasada" : "Programado";
}

export function filterDriverActivity(
  entries: readonly DriverActivity[],
  { period, today, area, from, to }: {
    period: DriverActivityPeriod; today: string; area?: string; from?: string; to?: string;
  }
) {
  const compareStart = (a: DriverActivity, b: DriverActivity) =>
    a.date.localeCompare(b.date) ||
    (a.startsAt?.getTime() ?? Infinity) - (b.startsAt?.getTime() ?? Infinity) ||
    a.id.localeCompare(b.id);

  return entries.filter((entry) => {
    const endDate = entry.endsAt ? localDateKey(entry.endsAt) : entry.date;
    return activityPeriod(entry, today) === period &&
      (!area || entry.area === area) &&
      (!from || endDate >= from) &&
      (!to || entry.date <= to);
  }).sort(period === "historial" ? (a, b) => compareStart(b, a) : compareStart);
}
