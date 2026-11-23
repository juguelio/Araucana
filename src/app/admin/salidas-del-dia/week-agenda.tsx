import Link from "next/link";
import { AREA_LABEL, personName, shiftDateKey } from "@/lib/operations/day-board";
import type { readDispatchDays } from "@/lib/operations/dispatch-days";
import { panelServiceHref } from "@/lib/operations/dispatch";

const label = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const clock = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Salta" });
export function WeekAgenda({ days }: { days: Awaited<ReturnType<typeof readDispatchDays>> }) {
  const start = days[0].date;
  return <section className="console-work" aria-label="Trabajo semanal">
    <header className="console-section-head"><h3>Trabajo semanal</h3><nav className="console-switch" aria-label="Cambiar semana">
      <Link href={"/admin?vista=semana&date=" + shiftDateKey(start,-7)}>‹ Semana anterior</Link>
      <Link href={"/admin?vista=semana&date=" + shiftDateKey(start,7)}>Semana siguiente ›</Link>
    </nav></header>
    {days.map(({ date, board }) => <section className="ops-week-day" key={date}>
      <header><h4>{label.format(new Date(date))}</h4><Link href={"/admin?date=" + date}>Abrir jornada</Link></header>
      {board.rows.filter(r => !r.programmed).map(row => <Link key={row.key} className="ops-week-job" href={panelServiceHref(date, row.key)}>
        <strong>{row.timeText ?? (row.at ? clock.format(row.at) : "A coordinar")}</strong><span>{AREA_LABEL[row.area]} · {row.title}</span>
        <small>{row.units.map(u => u.vehicleName + " · " + ([u.driverName, u.coDriverName].filter(Boolean).join(" y ") || "Sin chofer")).join(" / ") ||
          [row.school && personName(row.school.driver), "Sin nave asignada"].filter(Boolean).join(" · ")}</small>
      </Link>)}
      {board.summary.services === 0 && <p>Sin servicios cargados.</p>}
      {board.summary.programmed > 0 && <Link href={"/admin?date=" + date + "#programacion"}>{board.summary.programmed} salidas programadas sin pasajeros</Link>}
    </section>)}
  </section>;
}
