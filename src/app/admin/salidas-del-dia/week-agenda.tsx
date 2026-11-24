import Link from "next/link";
import { AREA_LABEL, personName, type BoardRow } from "@/lib/operations/day-board";
import type { readDispatchDays } from "@/lib/operations/dispatch-days";
import { dispatchReview, type DispatchDamage } from "@/lib/operations/dispatch";

const weekday = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" });
const monthDay = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
const clock = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Salta" });

type Booking = { row: BoardRow; crew: string; alert?: string };
type Lane = { label: string; slots: Map<string, Booking[]> };
type Props = { days: Awaited<ReturnType<typeof readDispatchDays>>; people: boolean; focus?: string; today: string; damages: ReadonlyMap<string, DispatchDamage[]> };

export function WeekAgenda({ days, people, focus, today, damages }: Props) {
  const start = days[0].date;
  const selected = days.find(day => day.date === focus)?.date ?? start;
  const weekly = (date: string, drivers: boolean) => "/admin?" + new URLSearchParams({ vista: "semana", date: start, dia: date, ...(drivers ? { tipo: "chofer" } : {}) });
  const lanes = new Map<string, Lane>();
  const missing = people ? "Sin chofer" : "Sin nave";
  for (const { date, board, assignments } of days) {
    const { summaries } = dispatchReview(board.rows, assignments, damages);
    for (const row of board.rows.filter(row => !row.programmed)) {
      const resources = new Map<string, { label: string; crew: Set<string> }>();
      function include(id: string | null | undefined, label: string | null | undefined, crew: string) {
        const key = id || "";
        const item = resources.get(key) ?? { label: label || missing, crew: new Set<string>() };
        if (crew) item.crew.add(crew);
        resources.set(key, item);
      }
      for (const unit of row.units) {
        if (people) {
          include(unit.driverId, unit.driverName, unit.vehicleName);
          if (unit.coDriverId) include(unit.coDriverId, unit.coDriverName, unit.vehicleName);
        } else include(unit.vehicleId, unit.vehicleName, [unit.driverName, unit.coDriverName].filter(Boolean).join(" y ") || "Sin chofer");
      }
      if (!resources.size) {
        const driver = row.school?.driver;
        include(people ? driver?.id : null, people && driver ? personName(driver) : null, people ? "Sin nave" : driver ? personName(driver) ?? "" : "");
      }
      for (const [key, resource] of resources) {
        const lane = lanes.get(key) ?? { label: resource.label, slots: new Map<string, Booking[]>() };
        const slot = lane.slots.get(date) ?? [];
        slot.push({ row, crew: [...resource.crew].join(" · "), alert: summaries.get(row.key) });
        lane.slots.set(date, slot);
        lanes.set(key, lane);
      }
    }
  }
  const sorted = [...lanes].sort(([a, x], [b, y]) => !a ? -1 : !b ? 1 : x.label.localeCompare(y.label, "es"));
  return <section className="week-planner" aria-label="Planificación semanal">
    <header className="week-tools"><h2>Plan de trabajo</h2><nav aria-label="Agrupar el plan">
      <Link aria-current={!people ? "page" : undefined} href={weekly(selected,false)}>Por nave</Link>
      <Link aria-current={people ? "page" : undefined} href={weekly(selected,true)}>Por chofer</Link>
    </nav></header>
    <nav className="week-days" aria-label="Día del plan">{days.map(({ date }) => <Link key={date} href={weekly(date,people)} aria-current={date === selected ? "date" : undefined}>{weekday.format(new Date(date))}<strong>{date.slice(-2)}</strong></Link>)}</nav>
    <div className="week-board"><table><thead><tr><th scope="col">{people ? "Chofer" : "Nave"}</th>{days.map(({ date, board }) => <th key={date} scope="col" data-selected={date === selected} data-today={date === today}>
      <Link href={"/admin?date=" + date}>{weekday.format(new Date(date))} {monthDay.format(new Date(date))}<small>{board.summary.services} {board.summary.services === 1 ? "servicio" : "servicios"}</small></Link>
    </th>)}</tr></thead><tbody>{sorted.map(([id, lane]) => <tr key={id} data-active={lane.slots.has(selected)}><th scope="row">{lane.label}</th>{days.map(({date}) => <td key={date} data-selected={date === selected}>
      {lane.slots.get(date)?.map(({row,crew,alert}) => <Link key={row.key} className="week-job" data-alert={!!alert} href={"/admin?" + new URLSearchParams({date, servicio:row.key, semana:start, ...(people ? {tipo:"chofer"} : {})}) + "#servicio-" + encodeURIComponent(row.key)}>
        <small>{row.at ? clock.format(row.at) : row.timeText || "A coordinar"} · {AREA_LABEL[row.area]}</small><strong>{row.title}</strong>{crew && <span>{crew}</span>}{alert && <em>{alert}</em>}
      </Link>)}
    </td>)}</tr>)}</tbody></table></div>
    {!sorted.length && <p>Sin servicios asignados para esta semana.</p>}
    {!!sorted.length && !sorted.some(([,lane]) => lane.slots.has(selected)) && <p className="week-mobile-empty">Sin servicios para este día.</p>}
    {days.some(day => day.board.summary.programmed > 0) && <details className="week-programs"><summary>Salidas programadas sin pasajeros</summary>{days.filter(day => day.board.summary.programmed > 0).map(day => <Link key={day.date} href={"/admin?date=" + day.date + "&programadas=1#programacion"}>{monthDay.format(new Date(day.date))} · {day.board.summary.programmed} programadas</Link>)}</details>}
  </section>;
}
