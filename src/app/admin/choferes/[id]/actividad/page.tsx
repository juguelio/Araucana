import Link from "next/link";
import { notFound } from "next/navigation";
import { Paginador } from "@/components/admin-list/paginador";
import { AdminShell } from "@/components/admin-shell";
import { hrefDePagina, leerPagina, paginar } from "@/lib/admin/list-order";
import { getCurrentDriverManagerOrRedirect } from "@/lib/auth/admin";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import {
  activityStatus, driverActivityAreas, driverActivityPeriods, filterDriverActivity, type DriverActivityPeriod
} from "@/lib/driver/activity";
import { listDriverActivity } from "@/lib/driver/activity-repository";
import { localDateKey, type BoardArea } from "@/lib/operations/day-board";
import { dateOnly } from "@/lib/special-trips/data";
import "./driver-activity.css";

type Query = Record<string, string | string[] | undefined>;

const localTime = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Salta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateLabel = (date: string) => date.split("-").reverse().join("/");

export const metadata = {
  title: "Actividad del chofer · La Araucana",
  robots: { index: false, follow: false }
};

export default async function DriverActivityPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Query>;
}) {
  const actor = await getCurrentDriverManagerOrRedirect();
  const { id } = await params;
  const driver = await prisma.user.findFirst({
    where: { id, role: "DRIVER" },
    select: { id: true, name: true, email: true, isActive: true }
  });
  if (!driver) notFound();

  const query = await searchParams ?? {};
  const now = new Date();
  const today = localDateKey(now);
  const dateFilter = (value: Query[string]) => typeof value === "string" && dateOnly(value) ? value : undefined;
  const from = dateFilter(query.desde);
  const to = dateFilter(query.hasta);
  const area = typeof query.tipo === "string" && Object.hasOwn(driverActivityAreas, query.tipo) ? query.tipo as BoardArea : undefined;
  const period = typeof query.vista === "string" && Object.hasOwn(driverActivityPeriods, query.vista) ? query.vista as DriverActivityPeriod : "hoy";
  const driverHref = `/admin/choferes/${driver.id}`;
  const base = `${driverHref}/actividad`;
  const actorIsAdmin = isAdminRole(actor.role);
  const invalidRange = Boolean(from && to && from > to);
  const entries = await listDriverActivity(driver.id);
  const rows = invalidRange ? [] : filterDriverActivity(entries, { period, today, area, from, to });
  const page = paginar(rows, leerPagina(query.page), 25);

  return (
    <AdminShell role={actor.role} title={driver.name || driver.email} eyebrow="Actividad del chofer"
      action={<div className="inline-actions">
        <Link className="ghost-button" href="/admin/choferes">Volver a choferes</Link>
        <Link className="button" href={driverHref}>Editar chofer</Link>
      </div>}
    >
      <p className="inline-actions">
        <span>{driver.email}</span>
        <span className={`status-pill ${driver.isActive ? "active" : "inactive"}`}>{driver.isActive ? "Activo" : "Inactivo"}</span>
      </p>
      <section className="plain-card admin-section driver-activity" aria-labelledby="driver-activity-title">
        <h2 id="driver-activity-title">Salidas y servicios</h2>
        <nav className="inline-actions driver-activity-periods" aria-label="Período de actividad">
          {Object.entries(driverActivityPeriods).map(([key, label]) => (
            <Link key={key}
              className={key === period ? "button" : "ghost-button"}
              href={hrefDePagina(base, { vista: key, tipo: area }, 1)}
              aria-current={key === period ? "page" : undefined}
            >{label}</Link>
          ))}
        </nav>
        <form action={base} className="admin-form-grid driver-activity-filters">
          <input type="hidden" name="vista" value={period} />
          <label>Tipo de servicio
            <select name="tipo" defaultValue={area ?? ""}>
              <option value="">Todos</option>
              {Object.entries(driverActivityAreas).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          {period !== "hoy" && <>
            <label>Desde<input type="date" name="desde" defaultValue={from} /></label>
            <label>Hasta<input type="date" name="hasta" defaultValue={to} /></label>
          </>}
          <div className="form-actions">
            <button className="ghost-button" type="submit">Filtrar</button>
          </div>
        </form>
        {invalidRange ? <p className="error" role="alert">La fecha «Hasta» debe ser igual o posterior a «Desde».</p> : null}
        <div className="table-scroll">
          <table className="data-table driver-activity-table">
            <thead>
              <tr><th scope="col">Fecha y hora</th><th scope="col">Servicio</th><th scope="col">Nave</th><th scope="col">Estado</th><th scope="col">Orden o planilla</th></tr>
            </thead>
            <tbody>
              {page.items.map((entry) => {
                const endDate = entry.endsAt ? localDateKey(entry.endsAt) : null;
                return (
                  <tr key={entry.id}>
                    <td>
                      <time dateTime={entry.startsAt?.toISOString() ?? entry.date}>
                        {dateLabel(entry.date)}{entry.startsAt ? ` · ${localTime.format(entry.startsAt)}` : ""}
                      </time>
                      {entry.endsAt && endDate ? <small>Hasta {endDate === entry.date ? "" : `${dateLabel(endDate)} · `}{localTime.format(entry.endsAt)}</small> : null}
                    </td>
                    <td><strong>{entry.title}</strong><small>{driverActivityAreas[entry.area]}</small></td>
                    <td>{entry.vehicle}</td>
                    <td>{activityStatus(entry, now)}</td>
                    <td>
                      <div className="driver-activity-links">
                        {entry.links.filter((link) => !link.adminOnly || actorIsAdmin).map((link) =>
                          <Link key={link.href} href={link.href} prefetch={false}>{link.label}</Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!page.total && <tr><td colSpan={5}>{invalidRange ? "Corregí el rango de fechas para ver la actividad." : "No hay servicios asignados para esta vista."}</td></tr>}
            </tbody>
          </table>
        </div>
        <Paginador {...page}
          hrefPagina={(n) => hrefDePagina(base, { vista: period, tipo: area, desde: from, hasta: to }, n)}
          etiqueta="servicios del chofer" />
      </section>
    </AdminShell>
  );
}
