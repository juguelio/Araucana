import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { dateOnly, localInput, statuses } from "@/lib/special-trips/data";
import { dayInterval } from "@/lib/special-trips/conflicts";
import {
  agruparPorMes, claveDia, condicionVista, etiquetaFecha, etiquetaGrupo, etiquetaRelativa, mesesConViajes, rangoMes, sumarDias,
  tonoFila, vistaDe, vistas, type Vista
} from "./listado";
import "./listado.css";

const base = "/admin/viajes-especiales";
const porPagina = 50;
const claves = ["vista", "mes", "q", "estado", "nave", "semana", "pagina"] as const;

function duration(start: Date, end: Date) {
  const minutes = Math.floor((+end - +start) / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const remainder = minutes % 60;
  return [days && `${days} d`, hours && `${hours} h`, remainder && `${remainder} min`].filter(Boolean).join(" ");
}

export default async function SpecialTripsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === "string" ? params[key].trim() : "";
  const hoy = dateOnly(localInput(new Date()).slice(0, 10))!;
  const vista: Vista = vistaDe(value("vista"));
  const mes = rangoMes(value("mes")) ? value("mes") : "";
  const q = value("q");
  const status = Object.hasOwn(statuses, value("estado")) ? value("estado") : "";
  const vehicleId = value("nave");
  const week = dateOnly(value("semana")) ?? hoy;
  const weekKey = (days: number) => claveDia(sumarDias(week, days));
  const { startsAt } = dayInterval(weekKey(0));
  const { startsAt: endsAt } = dayInterval(weekKey(7));

  // La vista fija el filtro base; un mes elegido la reemplaza por el mes completo en orden cronológico.
  const condicion = condicionVista(vista, hoy);
  const filtroMes = rangoMes(mes);
  const where: Prisma.SpecialTripWhereInput = {
    ...(filtroMes ? { serviceDate: filtroMes } : condicion.where),
    ...(status && { status }),
    ...(q && { OR: [{ client: { contains: q, mode: "insensitive" } }, { destinationSearch: { contains: q, mode: "insensitive" } }] }),
    ...(vehicleId && { assignments: { some: { vehicleId } } })
  };
  const orden = filtroMes ? "asc" : condicion.orden;
  const page = Math.min(10000, Math.max(1, Number.parseInt(value("pagina"), 10) || 1));
  const contar = (v: Vista) => prisma.specialTrip.count({ where: condicionVista(v, hoy).where });
  const [vehicles, trips, count, fechas, agenda, nHoy, nSemana, nPendientes, nSinNave] = await Promise.all([
    prisma.vehicle.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.specialTrip.findMany({
      where, skip: (page - 1) * porPagina, take: porPagina, orderBy: [{ serviceDate: orden }, { client: "asc" }],
      include: { assignments: { select: { vehicleId: true }, orderBy: { startsAt: "asc" } } }
    }),
    prisma.specialTrip.count({ where }),
    prisma.specialTrip.findMany({ select: { serviceDate: true } }),
    prisma.specialTripAssignment.findMany({
      where: { startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, trip: { status: { not: "CANCELLED" } }, ...(vehicleId && { vehicleId }) },
      orderBy: { startsAt: "asc" }, include: { trip: { select: { client: true, status: true } } }
    }),
    contar("hoy"), contar("semana"), contar("pendientes"), contar("sinNave")
  ]);
  const naves = new Map(vehicles.map((v) => [v.id, v.name]));
  const meses = mesesConViajes(fechas.map((f) => f.serviceDate));
  const conteos: Partial<Record<Vista, number>> = { hoy: nHoy, semana: nSemana, pendientes: nPendientes, sinNave: nSinNave, todos: fechas.length };
  const url = (changes: Partial<Record<typeof claves[number], string>>) => {
    const query = new URLSearchParams();
    for (const key of claves) {
      const selected = changes[key] ?? value(key);
      if (selected && !(key === "vista" && selected === "proximos")) query.set(key, selected);
    }
    const s = query.toString();
    return s ? `${base}?${s}` : base;
  };
  const desde = count ? (page - 1) * porPagina + 1 : 0;
  const hasta = Math.min(page * porPagina, count);
  const titulo = filtroMes ? `Viajes de ${meses.find((m) => m.clave === mes)?.label ?? mes}` : vistas[vista];
  const grupos = agruparPorMes(trips);

  return <AdminShell title="Viajes especiales" role={user.role} action={<div className="inline-actions">
    <Link href={`${base}/importar`} className="ghost-button">Importar historial</Link>
    <Link href={`${base}/nuevo`} className="button">Nuevo viaje</Link>
  </div>}>
    <section className="plain-card admin-section">
      <ul className="vesp-vistas" aria-label="Vistas rápidas">
        {(Object.keys(vistas) as Vista[]).map((v) => <li key={v}>
          <Link href={url({ vista: v, mes: "", pagina: "" })} className={`dia-chip${v === vista && !filtroMes ? " activo" : ""}`}
            aria-current={v === vista && !filtroMes ? "page" : undefined} data-alerta={(v === "sinNave" || v === "pendientes") && !!conteos[v]}>
            {vistas[v]}{conteos[v] !== undefined && <small>{conteos[v]}</small>}
          </Link>
        </li>)}
      </ul>
      <form method="get" className="admin-form-grid vesp-filtros">
        <input type="hidden" name="vista" value={vista} />
        {mes && <input type="hidden" name="mes" value={mes} />}
        <label>Cliente o destino<input name="q" defaultValue={q} placeholder="Buscar…" /></label>
        <label>Estado<select name="estado" defaultValue={status}><option value="">Todos</option>{Object.entries(statuses).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label>Nave<select name="nave" defaultValue={vehicleId}><option value="">Todas</option>{vehicles.map((v) => <option value={v.id} key={v.id}>{v.name}</option>)}</select></label>
        <div className="inline-actions">
          <button className="ghost-button">Filtrar</button>
          {(q || status || vehicleId || mes) && <Link href={url({ q: "", estado: "", nave: "", mes: "", pagina: "" })}>Limpiar</Link>}
        </div>
        {!!meses.length && <div className="dia-field vesp-meses">
          <span className="dia-label">Por mes</span>
          <div className="dia-tira">
            {meses.map((m) => <Link key={m.clave} href={url({ mes: m.clave === mes ? "" : m.clave, pagina: "" })} title={`${m.count} viajes`}
              className={`dia-chip${m.clave === mes ? " activo" : ""}`} aria-current={m.clave === mes ? "page" : undefined}>{m.label}</Link>)}
          </div>
        </div>}
      </form>
    </section>

    <section className="plain-card admin-section">
      <h2>{titulo}</h2>
      <p className="vesp-resumen">
        <span>{count ? `${desde}–${hasta} de ${count} viajes` : "Sin viajes para esta vista."}</span>
        {orden === "asc" ? <span>Del más próximo al más lejano</span> : <span>Del más reciente al más antiguo</span>}
      </p>
      {!!trips.length && <div className="table-scroll"><table className="data-table vesp-tabla">
        <thead><tr><th>Fecha</th><th>Cliente</th><th>Destino o servicio</th><th>Pax</th><th>Nave</th><th>Estado</th></tr></thead>
        {grupos.map((grupo) => <tbody key={grupo.clave} className="vesp-grupo">
          {(grupos.length > 1 || filtroMes === null) && <tr><th colSpan={6} scope="rowgroup">{etiquetaGrupo(grupo.fecha)}</th></tr>}
          {grupo.items.map((trip) => {
            const asignadas = [...new Set(trip.assignments.map((a) => naves.get(a.vehicleId) ?? "Nave"))];
            const estado = tonoFila(trip, asignadas.length > 0, hoy);
            return <tr key={trip.id}>
              <td className="vesp-num" data-hoy={claveDia(trip.serviceDate) === claveDia(hoy)}>{etiquetaRelativa(trip.serviceDate, hoy) && <strong>{etiquetaRelativa(trip.serviceDate, hoy)} · </strong>}{etiquetaFecha(trip.serviceDate, hoy)}</td>
              <td className="vesp-cliente"><Link href={`${base}/${trip.id}`}>{trip.client}</Link>{trip.contact && <small>{trip.contact}</small>}</td>
              <td>{trip.destinationSearch.replaceAll("\n", " · ")}</td>
              <td className="vesp-num">{trip.passengers ?? "—"}</td>
              <td className="vesp-nave">{asignadas.length ? <strong>{asignadas.join(", ")}</strong> : "Sin nave"}</td>
              <td><span className="pill pill-estado" data-tono={estado.tono}>{estado.label}</span></td>
            </tr>;
          })}
        </tbody>)}
      </table></div>}
      {count > porPagina && <nav className="pagination" aria-label="Paginación de viajes">
        {page > 1 ? <Link className="pagination-link" href={url({ pagina: String(page - 1) })} rel="prev">← Anterior</Link> : <span aria-disabled="true" className="pagination-link">← Anterior</span>}
        <span className="pagination-status">Página {page} de {Math.ceil(count / porPagina)}</span>
        {hasta < count ? <Link className="pagination-link" href={url({ pagina: String(page + 1) })} rel="next">Siguiente →</Link> : <span aria-disabled="true" className="pagination-link">Siguiente →</span>}
      </nav>}
    </section>

    <section className="plain-card admin-section vesp-agenda">
      <details open={agenda.length > 0}>
        <summary>Agenda por nave · del {etiquetaFecha(sumarDias(week, 0), hoy)} al {etiquetaFecha(sumarDias(week, 6), hoy)}{agenda.length ? ` · ${agenda.length} ocupaciones` : " · sin ocupaciones"}</summary>
        <p className="muted">Hora argentina. Sólo aparecen las naves con ocupaciones cargadas en el viaje.</p>
        <div className="inline-actions">
          <Link href={url({ semana: weekKey(-7) })}>← Semana anterior</Link>
          <Link href={url({ semana: claveDia(hoy) })}>Esta semana</Link>
          <Link href={url({ semana: weekKey(7) })}>Semana siguiente →</Link>
        </div>
        <form method="get" className="inline-actions">
          <label>Empezar la semana el <input type="date" name="semana" defaultValue={weekKey(0)} required /></label>
          {claves.filter((k) => k !== "semana" && k !== "pagina").map((key) => <input key={key} type="hidden" name={key} value={value(key)} />)}
          <button className="ghost-button">Ver semana</button>
        </form>
        {vehicles.filter((v) => agenda.some((a) => a.vehicleId === v.id)).map((vehicle) => <section key={vehicle.id}>
          <h3>{vehicle.name}</h3>
          <ul>{agenda.filter((a) => a.vehicleId === vehicle.id).map((a) => <li key={a.id}>
            <Link href={`${base}/${a.tripId}`}>{a.trip.client}</Link> · {localInput(a.startsAt).replace("T", " ")} → {localInput(a.endsAt).replace("T", " ")} · {duration(a.startsAt, a.endsAt)} · {statuses[a.trip.status as keyof typeof statuses]}
          </li>)}</ul>
        </section>)}
        {!agenda.length && <p>Sin ocupaciones de naves en esta semana.</p>}
      </details>
    </section>
  </AdminShell>;
}
