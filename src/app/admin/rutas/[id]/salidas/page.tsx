import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { listAdminSchedules } from "@/lib/booking/repository";
import { prisma } from "@/lib/db/prisma";
import { deleteScheduleAction, setScheduleStatusAction } from "../../../salidas/actions";

type RouteSchedulesPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ month?: string; notice?: string }>;
};

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "America/Argentina/Salta"
});

const shortDateFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  timeZone: "America/Argentina/Salta"
});

const timeFormatter = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Salta"
});

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Salta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function dateKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Salta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function statusLabel(status: string) {
  return { OPEN: "Abierta", DOCUMENTATION: "Documentación", CLOSED: "Cerrada" }[status] ?? status;
}

function validMonth(value?: string) {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : todayKey().slice(0, 7);
}

function monthTitle(month: string) {
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "America/Argentina/Salta" })
    .format(new Date(`${month}-15T12:00:00-03:00`));
}

function calendarDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1, 12));
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0, 12)).getUTCDate();
  const leadingDays = (firstDay.getUTCDay() + 6) % 7;
  const totalCells = Math.ceil((leadingDays + daysInMonth) / 7) * 7;

  return Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - leadingDays + 1;
    if (dayNumber < 1 || dayNumber > daysInMonth) {
      return null;
    }

    return `${month}-${String(dayNumber).padStart(2, "0")}`;
  });
}

function monthOffset(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function RouteSchedulesPage({ params, searchParams }: RouteSchedulesPageProps) {
  await getCurrentAdminOrRedirect();
  const { id } = await params;
  const query = await searchParams;
  const [route, schedules] = await Promise.all([
    prisma.travelRoute.findUnique({ where: { id }, select: { id: true, from: true, to: true, via: true, category: true } }),
    // Sólo las salidas de esta ruta: antes traía las de todas las rutas y filtraba acá.
    listAdminSchedules({ routeId: id })
  ]);

  if (!route) {
    notFound();
  }

  const routeSchedules = schedules.filter((schedule) => schedule.routeId === route.id);
  const today = todayKey();
  const upcomingSchedules = routeSchedules.filter((schedule) => dateKey(schedule.departureAt) >= today);
  const nextSchedule = upcomingSchedules[0];
  const openSchedules = routeSchedules.filter((schedule) => schedule.status === "OPEN" || schedule.status === "DOCUMENTATION").length;
  const availableSeats = routeSchedules.reduce((total, schedule) => total + schedule.availableSeats, 0);
  const totalSeats = routeSchedules.reduce((total, schedule) => total + schedule.totalSeats, 0);
  const month = validMonth(query?.month);
  const days = calendarDays(month);
  const schedulesByDay = new Map<string, typeof routeSchedules>();

  for (const schedule of routeSchedules) {
    const key = dateKey(schedule.departureAt);
    const daySchedules = schedulesByDay.get(key) ?? [];
    daySchedules.push(schedule);
    schedulesByDay.set(key, daySchedules);
  }

  return (
    <AdminShell
      title={`${route.from} → ${route.to}`}
      eyebrow="Salidas de la ruta"
      notice={query?.notice}
      action={
        <div className="inline-actions">
          <Link className="ghost-button" href="/admin/rutas">Volver a rutas</Link>
          <Link className="button" href={`/admin/rutas/${route.id}/salidas/nueva?date=${today}`}>Agregar salida</Link>
        </div>
      }
    >
      <section className="route-schedule-hero">
        <div>
          <p className="eyebrow">{route.category} · {route.via}</p>
          <h2>Todo el movimiento de esta ruta, en un solo lugar.</h2>
          <p>Consultá el calendario completo, controlá los cupos disponibles y abrí cualquier salida para editarla.</p>
        </div>
        <div className="route-schedule-next">
          <span>Próxima salida</span>
          {nextSchedule ? (
            <>
              <strong>{shortDateFormatter.format(nextSchedule.departureAt)} · {timeFormatter.format(nextSchedule.departureAt)}</strong>
              <small>{nextSchedule.availableSeats} de {nextSchedule.totalSeats} asientos libres</small>
            </>
          ) : <strong>No hay salidas futuras</strong>}
        </div>
      </section>

      <section className="route-schedule-stats" aria-label="Resumen de salidas">
        <div><span>Total programadas</span><strong>{routeSchedules.length}</strong><small>Histórico completo</small></div>
        <div><span>Desde hoy</span><strong>{upcomingSchedules.length}</strong><small>Incluye las de hoy</small></div>
        <div><span>Disponibles</span><strong>{openSchedules}</strong><small>Abiertas o en documentación</small></div>
        <div><span>Cupos libres</span><strong>{availableSeats}/{totalSeats}</strong><small>Sumatoria de la ruta</small></div>
      </section>

      <section className="plain-card admin-section route-schedule-list">
        <div className="admin-edit-head">
          <div>
            <p className="eyebrow">Calendario operativo</p>
            <h2>{monthTitle(month)}</h2>
          </div>
          <div className="calendar-month-actions">
            <Link className="ghost-button" href={`?month=${monthOffset(month, -1)}`} aria-label="Mes anterior">←</Link>
            <Link className="ghost-button" href={`?month=${todayKey().slice(0, 7)}`}>Hoy</Link>
            <Link className="ghost-button" href={`?month=${monthOffset(month, 1)}`} aria-label="Mes siguiente">→</Link>
          </div>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="route-calendar">
          {days.map((day, index) => {
            const daySchedules = day ? schedulesByDay.get(day) ?? [] : [];
            return (
              <div className={`calendar-day ${day ? "" : "is-empty"}`} key={day ?? `empty-${index}`}>
                {day ? <>
                  <div className="calendar-day-head">
                    <strong>{Number(day.slice(-2))}</strong>
                    <Link href={`/admin/rutas/${route.id}/salidas/nueva?date=${day}`} aria-label={`Agregar salida el ${day}`}>+</Link>
                  </div>
                  <div className="calendar-day-schedules">
                    {daySchedules.map((schedule) => (
                      <article className={`calendar-schedule ${schedule.status === "CLOSED" ? "is-closed" : ""}`} key={schedule.id}>
                        <div className="calendar-schedule-line">
                          <strong>{timeFormatter.format(schedule.departureAt)}</strong>
                          <span>{schedule.availableSeats}/{schedule.totalSeats}</span>
                        </div>
                        <small>{statusLabel(schedule.status)}</small>
                        <div className="calendar-schedule-actions">
                          <Link href={`/admin/rutas/${route.id}/salidas/${schedule.id}`}>Ver reservas</Link>
                          <Link href={`/admin/rutas/${route.id}/salidas/${schedule.id}`}>Modificar</Link>
                          <form action={setScheduleStatusAction}>
                            <input type="hidden" name="id" value={schedule.id} />
                            <input type="hidden" name="status" value={schedule.status === "CLOSED" ? "OPEN" : "CLOSED"} />
                            <button type="submit">{schedule.status === "CLOSED" ? "Abrir" : "Cerrar"}</button>
                          </form>
                          <form action={deleteScheduleAction}>
                            <input type="hidden" name="id" value={schedule.id} />
                            <button type="submit" aria-label="Eliminar salida">×</button>
                          </form>
                        </div>
                      </article>
                    ))}
                    {!daySchedules.length ? <Link className="calendar-add-empty" href={`/admin/rutas/${route.id}/salidas/nueva?date=${day}`}>Agregar salida</Link> : null}
                  </div>
                </> : null}
              </div>
            );
          })}
        </div>
      </section>
    </AdminShell>
  );
}
