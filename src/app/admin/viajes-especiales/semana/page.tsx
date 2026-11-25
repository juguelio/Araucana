import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { ROTULO_DE_SERVICIOS } from "@/components/modulo/modulo";
import { WeeklyCalendar } from "@/components/weekly-calendar/weekly-calendar";
import { calendarWeekStart } from "@/lib/admin/weekly-calendar";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { prisma } from "@/lib/db/prisma";
import { lunesDe } from "@/lib/school-runs/week";
import { statuses } from "@/lib/special-trips/data";
import { specialTripsPath as base } from "../view";
import { SpecialTripsViewTabs } from "../view-tabs";
import { TripCalendarDate } from "./trip-calendar-date";
import { loadSpecialTripsWeek, readTripCalendarFilters } from "./data";
import "../listado.css";

export const metadata = { title: "Viajes especiales · Calendario semanal · La Araucana" };

export default async function SpecialTripsWeekPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const filters = readTripCalendarFilters((key) => params[key]);
  const today = argentinaDateKey();
  const start = calendarWeekStart(params.semana) ?? lunesDe(today);
  const [initial, vehicles] = await Promise.all([
    loadSpecialTripsWeek(start, filters),
    prisma.vehicle.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
  ]);
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q);
  if (filters.status) query.set("estado", filters.status);
  if (filters.vehicleId) query.set("nave", filters.vehicleId);
  const suffix = query.size ? `?${query}` : "";

  return (
    <AdminShell title="Viajes especiales" eyebrow={ROTULO_DE_SERVICIOS} role={user.role}
      action={<div className="inline-actions">
        <Link className="ghost-button" href={`${base}/importar`}>Importar</Link>
        <Link className="button" href={`${base}/nuevo`}>Nuevo viaje</Link>
      </div>}>
      <SpecialTripsViewTabs active="calendario" />
      <form action={`${base}/semana`} className="admin-form-grid plain-card admin-section">
        <TripCalendarDate start={start} />
        <label>Cliente, destino o contacto<input name="q" type="search" defaultValue={filters.q} placeholder="Buscar…" /></label>
        <label>Estado<select name="estado" defaultValue={filters.status}>
          <option value="">Todos</option>
          {Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>Nave<select name="nave" defaultValue={filters.vehicleId}>
          <option value="">Todas</option>
          {vehicles.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <div className="inline-actions">
          <button className="ghost-button" type="submit">Filtrar</button>
          {query.size > 0 && <Link href={`${base}/semana?semana=${start}`}>Limpiar filtros</Link>}
        </div>
      </form>
      <WeeklyCalendar key={`${start}${suffix}`} start={start} today={today} initial={initial} dataUrl={`${base}/semana/datos${suffix}`}
        label="Calendario de viajes especiales" singular="viaje" plural="viajes" empty="Sin viajes" />
    </AdminShell>
  );
}
