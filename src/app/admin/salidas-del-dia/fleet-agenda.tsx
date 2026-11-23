import { prisma } from "@/lib/db/prisma";
import { driverPlan } from "@/lib/operations/driver-plan";
import { markDriverNotified } from "./notice-actions";
import { CopyPlan } from "./copy-plan";
import Link from "next/link";
import { AREA_LABEL } from "@/lib/operations/day-board";
import { panelServiceHref, type DispatchAssignment, type DispatchDamage } from "@/lib/operations/dispatch";
import { estadoDeTaller } from "@/lib/vehicles/estado-en-flota";
import { ESTADO_DANIO_LABEL, ESTADOS_DE_DANIO, GRAVEDAD_LABEL, esGravedad } from "@/lib/vehicles/ficha";
import { createDamageAction, setDamageStatusAction } from "../naves/[id]/ficha-actions";
import { DamageForm } from "../naves/[id]/ficha-forms";
import { RowModal } from "../reservas/row-modal";
import type { Option } from "./crew-form";

const clock = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Salta", hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
export async function FleetAgenda({ date, drivers, vehicles, assignments, damages, people, onlyUnused, search, selected }: {
  date: string; drivers: Option[]; vehicles: Option[]; assignments: DispatchAssignment[];
  damages: ReadonlyMap<string, DispatchDamage[]>; people: boolean; onlyUnused: boolean; search: string; selected?: string;
}) {
  const notices = people ? await prisma.driverPlanNotice.findMany({ where: { serviceDate: new Date(date) } }) : [];
  const noticeByDriver = new Map(notices.map(item => [item.driverId, item]));
  const kind = people ? "driverId" : "vehicleId";
  const byResource = new Map<string, DispatchAssignment[]>();
  const resources = new Map((people ? drivers : vehicles).map(item => [item.id, item.label]));
  for (const a of assignments) {
    const team = people ? [[a.driverId, a.driverName], [a.coDriverId, a.coDriverName]] : [[a.vehicleId, a.vehicleName]];
    for (const [id, name] of team) {
      if (!id) continue;
      if (!resources.has(id)) resources.set(id, name || id);
      const agenda = byResource.get(id) ?? [];
      agenda.push(a);
      byResource.set(id, agenda);
    }
  }
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const visible = [...resources].filter(([id, name]) =>
    (!onlyUnused || !byResource.has(id)) && normalize(name).includes(normalize(search)));
  const links = (isDriver: boolean) => "/admin?" + new URLSearchParams({ date, vista: "flota", ...(isDriver ? { tipo: "chofer" } : {}) });
  return <section className="console-work" aria-label="Agenda de flota y choferes">
    <header className="console-section-head"><h3>Agenda del equipo</h3>
      <nav className="console-switch" aria-label="Agrupar agenda"><Link aria-current={!people ? "page" : undefined} href={links(false)}>Por nave</Link><Link aria-current={people ? "page" : undefined} href={links(true)}>Por chofer</Link></nav>
    </header>
    <form className="console-filters" action="/admin">
      <input type="hidden" name="date" value={date} /><input type="hidden" name="vista" value="flota" />
      {people && <input type="hidden" name="tipo" value="chofer" />}
      <label>Buscar en la flota<input type="search" name="q" defaultValue={search} placeholder={people ? "Nombre del chofer" : "Nombre o interno"} maxLength={100} /></label>
      <label>Asignaciones<select name="libres" defaultValue={onlyUnused ? "1" : ""}><option value="">Todo el equipo</option><option value="1">Sin servicios asignados</option></select></label>
      <button className="ghost-button">Filtrar equipo</button>
    </form>
    {!visible.length && <p>No hay coincidencias para estos filtros.</p>}
    {visible.map(([id, label]) => {
      const jobs = (byResource.get(id) ?? []).sort((a,b) => (a.start ?? Infinity) - (b.start ?? Infinity));
      const notice = noticeByDriver.get(id);
      const work = jobs.filter(a => !a.programmed);
      const plan = people && (work.length || notice) ? driverPlan(date, label, work) : null;
      const notified = !!notice && notice.fingerprint === plan?.fingerprint;
      const orderDates = [...new Set(jobs.filter(a => a.area === "AEROPUERTO").map(a => a.orderDate ?? date))];
      const reports = people ? [] : damages.get(id) ?? [];
      const taller = estadoDeTaller(reports);
      return <details className="console-resource" key={id} open={selected === id || undefined}>
        <summary><strong>{label}</strong><span>{jobs.length ? jobs.length + (jobs.length === 1 ? " tramo" : " tramos") : "Sin servicios asignados"}</span>
          {plan && <b className={notified ? "handoff-sent" : "console-warning"}>{notified ? "Avisado" : notice ? "Cambió · volver a avisar" : "Por avisar"}</b>}
          {reports.length > 0 && <b className="console-warning">{taller?.etiqueta ?? "Daño abierto"}</b>}</summary>
        <div className="console-resource-body">
          {reports.map(d => <div className="console-damage" key={d.id}>
            <span><strong>{esGravedad(d.severity) ? GRAVEDAD_LABEL[d.severity] : d.severity}</strong> · {d.description}</span>
            <form action={setDamageStatusAction}>
              <input type="hidden" name="damageId" value={d.id} /><input type="hidden" name="panelDate" value={date} />
              <select name="status" aria-label={"Estado del daño: " + d.description} defaultValue={d.status}>
                {ESTADOS_DE_DANIO.map(status => <option key={status} value={status}>{ESTADO_DANIO_LABEL[status]}</option>)}
              </select><button className="ghost-button">Guardar estado</button>
            </form>
          </div>)}
          {jobs.map(a => <Link className="console-job" href={panelServiceHref(date, a.rowKey)} key={a.key}>
            <strong>{a.start === null ? a.shift || "A coordinar" : clock.format(a.start)}{a.end !== null && " – " + clock.format(a.end)}</strong>
            <span>{AREA_LABEL[a.area]} · {a.title}<small>{people ? a.vehicleName : [a.driverName, a.coDriverName].filter(Boolean).join(" y ") || "Sin chofer"}{a.programmed && " · programada sin pasajeros"}{a.cancelled ? " · servicio interrumpido" : a.estimatedWindow ? " · horario estimado" : a.start !== null && a.end === null ? " · fin a coordinar" : ""}</small></span><b>Gestionar ›</b>
          </Link>)}
          {plan && <div className="handoff">
            <CopyPlan key={plan.fingerprint} message={plan.message} />
            {notified && notice ? <p>Aviso registrado por {notice.notifiedBy} el {notice.notifiedAt.toLocaleString("es-AR", { timeZone: "America/Argentina/Salta" })}.</p> :
              <form action={markDriverNotified.bind(null, date, id, plan.fingerprint, notice?.fingerprint ?? null)}>
                <button className="button">Marcar como avisado</button>
              </form>}
          </div>}
          <div className="console-resource-actions">
            {!people && <><RowModal trigger="Anotar daño" triggerClassName="ghost-button" triggerLabel={"Anotar daño de " + label} eyebrow="Flota" title="Anotar daño" subtitle={label}>
              <DamageForm action={createDamageAction} vehicleId={id} panelDate={date} />
            </RowModal><Link href={"/admin/naves/"+id}>Ficha de la nave</Link></>}
            {orderDates.map(day => <Link key={day} href={{ pathname: "/admin/aeropuerto/orden-de-servicio/ver", query: { date: day, [kind]: id } }}>Órdenes de aeropuerto{day !== date && " · " + day.split("-").reverse().join("/")}</Link>)}
          </div>
        </div>
      </details>;
    })}
  </section>;
}
