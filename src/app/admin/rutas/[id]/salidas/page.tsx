import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { EncabezadoOrdenable } from "@/components/admin-list/encabezado-ordenable";
import { Paginador } from "@/components/admin-list/paginador";
import { hrefDePagina, leerOrden, leerPagina, paginar } from "@/lib/admin/list-order";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { listAdminSchedules } from "@/lib/booking/repository";
import { vehicleLabel } from "@/lib/booking/schedule-vehicle";
import { prisma } from "@/lib/db/prisma";
import { deleteScheduleAction, setScheduleStatusAction } from "../../../salidas/actions";
import { ScheduleCard, statusLabel } from "./schedule-card";
import {
  COLUMNAS_SALIDAS,
  ORDEN_INICIAL_SALIDAS,
  ordenarSalidas,
  vistaDeSalidas,
  vistasDeSalidas,
  type VistaSalidas,
  type ColumnaSalida
} from "./lista";
import "./salidas.css";

const weekdayShort = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" });

/** Salidas por página de la lista (issue #192): la ruta más cargada tiene 124 en un mes. */
const POR_PAGINA = 50;

/** Cómo se nombra cada columna en el resumen de la lista («ordenada por…»). */
const etiquetasDeOrden: Record<ColumnaSalida, string> = {
  fecha: "fecha y hora",
  nave: "nave",
  estado: "estado",
  cupo: "lugares libres"
};

type RouteSchedulesPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ month?: string; notice?: string; vista?: string; orden?: string; dir?: string; page?: string }>;
};

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
  const sessionUser = await getCurrentAdminOrRedirect();
  const { id } = await params;
  const query = await searchParams;
  const [route, schedules, vehicles] = await Promise.all([
    prisma.travelRoute.findUnique({ where: { id }, select: { id: true, from: true, to: true, via: true, category: true } }),
    // Sólo las salidas de esta ruta: antes traía las de todas las rutas y filtraba acá.
    listAdminSchedules({ routeId: id }),
    // Para reasignar la nave desde el calendario (issue #81): las unidades activas de la flota.
    prisma.vehicle.findMany({
      where: { isActive: true },
      select: { id: true, name: true, licensePlate: true, internalNumber: true, _count: { select: { seats: true } } },
      orderBy: { name: "asc" }
    })
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

  // Issue #192: la misma lista de salidas, en calendario (programar) o en lista paginada (encontrar).
  const urlParams = query ?? {};
  const texto = (valor: string | undefined) => (typeof valor === "string" ? valor : undefined);
  const base = `/admin/rutas/${route.id}/salidas`;
  const vista = vistaDeSalidas(texto(urlParams.vista));
  const orden = leerOrden(COLUMNAS_SALIDAS, ORDEN_INICIAL_SALIDAS, { orden: texto(urlParams.orden), dir: texto(urlParams.dir) });
  const rango = paginar(ordenarSalidas(routeSchedules, orden), leerPagina(urlParams.page), POR_PAGINA);
  const hrefVista = (destino: VistaSalidas) =>
    hrefDePagina(base, { ...urlParams, vista: destino === "calendario" ? "" : destino }, 1);

  return (
    <AdminShell role={sessionUser.role}
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
      {/* Antes: un bloque grande con un eslogan. La próxima salida pasa a ser la primera cifra. */}
      <p className="salidas-ruta-meta">{route.category} · {route.via}</p>

      <section className="route-schedule-stats salidas-stats" aria-label="Resumen de salidas">
        <div className="salidas-proxima">
          <span>Próxima salida</span>
          {nextSchedule ? (
            <>
              <strong>{shortDateFormatter.format(nextSchedule.departureAt)} · {timeFormatter.format(nextSchedule.departureAt)}</strong>
              <small>{vehicleLabel({ name: nextSchedule.vehicleName, licensePlate: nextSchedule.vehiclePlate, internalNumber: nextSchedule.vehicleInternalNumber })} · {nextSchedule.availableSeats} de {nextSchedule.totalSeats} asientos libres</small>
            </>
          ) : <strong>No hay salidas futuras</strong>}
        </div>
        <div><span>Total programadas</span><strong>{routeSchedules.length}</strong><small>Histórico completo</small></div>
        <div><span>Desde hoy</span><strong>{upcomingSchedules.length}</strong><small>Incluye las de hoy</small></div>
        <div><span>Disponibles</span><strong>{openSchedules}</strong><small>Abiertas o en documentación</small></div>
        <div><span>Cupos libres</span><strong>{availableSeats}/{totalSeats}</strong><small>Sumatoria de la ruta</small></div>
      </section>

      <ul className="salidas-vistas" aria-label="Cómo ver las salidas">
        {(Object.keys(vistasDeSalidas) as VistaSalidas[]).map((opcion) => (
          <li key={opcion}>
            <Link
              className={`dia-chip${opcion === vista ? " activo" : ""}`}
              href={hrefVista(opcion)}
              aria-current={opcion === vista ? "page" : undefined}
            >
              {vistasDeSalidas[opcion]}
            </Link>
          </li>
        ))}
      </ul>

      {vista === "lista" ? (
        <section className="plain-card admin-section route-schedule-list">
          <div className="admin-edit-head">
            <div>
              <p className="eyebrow">Historial completo</p>
              <h2>Lista de salidas</h2>
            </div>
            <p className="salidas-lista-resumen">
              {rango.total === 1 ? "1 salida" : `${rango.total} salidas`} · ordenada por{" "}
              {etiquetasDeOrden[orden.columna]}, {orden.direccion === "asc" ? "de menor a mayor" : "de mayor a menor"}
            </p>
          </div>
          <div className="table-scroll">
            <table className="data-table salidas-lista" aria-label={`Salidas de ${route.from} a ${route.to}`}>
              <thead><tr>
                <EncabezadoOrdenable etiqueta="Fecha y hora" columna="fecha" orden={orden} base={base} params={urlParams} />
                <EncabezadoOrdenable etiqueta="Nave" columna="nave" orden={orden} base={base} params={urlParams} />
                <EncabezadoOrdenable etiqueta="Estado" columna="estado" orden={orden} base={base} params={urlParams} />
                <EncabezadoOrdenable etiqueta="Lugares libres" columna="cupo" orden={orden} base={base} params={urlParams} />
                <th>Acciones</th>
              </tr></thead>
              <tbody>
                {rango.items.map((schedule) => (
                  <tr key={schedule.id}>
                    <th scope="row" data-hoy={dateKey(schedule.departureAt) === today || undefined}>
                      {shortDateFormatter.format(schedule.departureAt)} · {timeFormatter.format(schedule.departureAt)}
                    </th>
                    <td>
                      {vehicleLabel({ name: schedule.vehicleName, licensePlate: schedule.vehiclePlate, internalNumber: schedule.vehicleInternalNumber })}
                      {schedule.extraVehicleNames?.length ? <small>+ {schedule.extraVehicleNames.join(" + ")}</small> : null}
                    </td>
                    <td>{statusLabel(schedule.status)}</td>
                    <td>{schedule.availableSeats}/{schedule.totalSeats}</td>
                    <td><Link className="table-link" href={`${base}/${schedule.id}`}>Ver salida</Link></td>
                  </tr>
                ))}
                {rango.items.length === 0 && (
                  <tr><td colSpan={5}>Todavía no hay salidas cargadas para esta ruta.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Paginador {...rango} hrefPagina={(numero) => hrefDePagina(base, urlParams, numero)} etiqueta="salidas de la ruta" />
        </section>
      ) : (
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
              <div
                className={`calendar-day ${day ? "" : "is-empty"}`}
                key={day ?? `empty-${index}`}
                data-hoy={day === today || undefined}
                data-pasado={(day !== null && day < today) || undefined}
                data-sin-salidas={(day !== null && daySchedules.length === 0) || undefined}
              >
                {day ? <>
                  <div className="calendar-day-head">
                    <strong>
                      {/* El día de la semana sólo se ve en el celular, donde el calendario pasa a lista. */}
                      <span className="calendar-day-weekday">{weekdayShort.format(new Date(`${day}T12:00:00Z`))}</span>
                      {Number(day.slice(-2))}
                    </strong>
                    <Link href={`/admin/rutas/${route.id}/salidas/nueva?date=${day}`} aria-label={`Agregar salida el ${day}`}>+</Link>
                  </div>
                  <div className="calendar-day-schedules">
                    {daySchedules.map((schedule) => (
                      <ScheduleCard
                        key={schedule.id}
                        schedule={schedule}
                        routeId={route.id}
                        vehicles={vehicles}
                        timeLabel={timeFormatter.format(schedule.departureAt)}
                      />
                    ))}
                  </div>
                </> : null}
              </div>
            );
          })}
        </div>
      </section>
      )}
    </AdminShell>
  );
}
