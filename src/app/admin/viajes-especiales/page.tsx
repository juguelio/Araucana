import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { dateOnly, localInput, statuses } from "@/lib/special-trips/data";
import { dayInterval } from "@/lib/special-trips/conflicts";
import { cantidadDias, esDeVariosDias, estadoDelDia, etiquetaRango, whereSolapa } from "@/lib/special-trips/rango";
import {
  agruparPorMes, claveDia, condicionVista, etiquetaFecha, etiquetaGrupo, etiquetaRelativa, mesesConViajes, rangoMes, sumarDias,
  tonoFila, vistaDe, vistas, type Vista
} from "./listado";
import { EncabezadoOrdenable, OrdenOculto } from "@/components/admin-list/encabezado-ordenable";
import { Paginador } from "@/components/admin-list/paginador";
import { leerOrden, type OrdenDeListado } from "@/lib/admin/list-order";
import "./listado.css";

const base = "/admin/viajes-especiales";
const porPagina = 50;
const claves = ["vista", "mes", "q", "estado", "nave", "semana", "pagina", "orden", "dir"] as const;

/** Columnas ordenables (issue #192). «Nave» no: un viaje puede tener varias asignadas. */
const COLUMNAS = ["fecha", "cliente", "destino", "pax", "estado"] as const;
type Columna = (typeof COLUMNAS)[number];
const ETIQUETAS: Record<Columna, string> = { fecha: "Fecha", cliente: "Cliente", destino: "Destino o servicio", pax: "Pax", estado: "Estado" };

/** `orderBy` de Prisma; a igual valor sigue la fecha de la vista y, al final, el id (las páginas no se pisan). */
function orderByDe({ columna, direccion }: OrdenDeListado<Columna>, porFecha: "asc" | "desc"): Prisma.SpecialTripOrderByWithRelationInput[] {
  const despues: Prisma.SpecialTripOrderByWithRelationInput[] = [{ serviceDate: porFecha }, { client: "asc" }, { id: "asc" }];
  switch (columna) {
    case "fecha": return [{ serviceDate: direccion }, { client: "asc" }, { id: "asc" }];
    case "cliente": return [{ client: direccion }, ...despues];
    case "destino": return [{ destinationSearch: direccion }, ...despues];
    case "pax": return [{ passengers: { sort: direccion, nulls: "last" } }, ...despues];
    case "estado": return [{ status: direccion }, ...despues];
  }
}

/** Lo que todavía no está cargado en el viaje, para verlo desde el listado sin abrir la ficha. */
function pendientesDe(trip: { status: string; totalCents: number | null; billingMode: string; contact: string | null; passengers: number | null; legs: unknown }, tieneNave: boolean) {
  if (trip.status === "CANCELLED" || trip.status === "COMPLETED") return [];
  return [
    !tieneNave ? "nave" : null,
    trip.totalCents === null && trip.billingMode !== "INCLUDED" ? "precio" : null,
    !trip.contact ? "contacto" : null,
    trip.passengers === null ? "pasajeros" : null,
    !Array.isArray(trip.legs) || trip.legs.length === 0 ? "itinerario" : null
  ].filter((x): x is string => x !== null);
}

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
  const semanaFin = sumarDias(hoy, 7);

  // La vista fija el filtro base; un mes elegido la reemplaza por el mes completo en orden cronológico.
  const condicion = condicionVista(vista, hoy);
  const filtroMes = rangoMes(mes);
  // En AND: la vista y el mes usan su propio OR (un viaje de varios días toca más de un día) y no se pisan con la búsqueda.
  const where: Prisma.SpecialTripWhereInput = {
    AND: [
      filtroMes ? whereSolapa(filtroMes.gte, filtroMes.lt) : condicion.where,
      ...(status ? [{ status }] : []),
      ...(q ? [{ OR: [{ client: { contains: q, mode: "insensitive" as const } }, { destinationSearch: { contains: q, mode: "insensitive" as const } }] }] : []),
      ...(vehicleId ? [{ assignments: { some: { vehicleId } } }] : [])
    ]
  };
  // La vista (o el mes) fija el sentido de la fecha; un encabezado clickeado lo reemplaza.
  const porFecha = filtroMes ? "asc" : condicion.orden;
  const orden = leerOrden(COLUMNAS, { columna: "fecha", direccion: porFecha }, { orden: value("orden"), dir: value("dir") });
  const ordenElegido = Boolean(value("orden")) && orden.columna === value("orden");
  const page = Math.min(10000, Math.max(1, Number.parseInt(value("pagina"), 10) || 1));
  const [vehicles, trips, count, dias, agenda, conteos] = await Promise.all([
    prisma.vehicle.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.specialTrip.findMany({
      where, skip: (page - 1) * porPagina, take: porPagina, orderBy: orderByDe(orden, porFecha),
      include: { assignments: { select: { vehicleId: true }, orderBy: { startsAt: "asc" } } }
    }),
    prisma.specialTrip.count({ where }),
    prisma.specialTrip.groupBy({ by: ["serviceDate"], _count: { _all: true } }),
    prisma.specialTripAssignment.findMany({
      where: { startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, trip: { status: { not: "CANCELLED" } }, ...(vehicleId && { vehicleId }) },
      orderBy: { startsAt: "asc" }, include: { trip: { select: { client: true, status: true } } }
    }),
    // Los números de las vistas, en una sola consulta: cada count suelto es otro viaje de ida y vuelta a la base.
    prisma.$queryRaw<{ hoy: number; semana: number; pendientes: number; sinnave: number; total: number }[]>`
      select
        count(*) filter (where t."serviceDate" <= ${claveDia(hoy)}::date and coalesce(t."endDate", t."serviceDate") >= ${claveDia(hoy)}::date)::int as hoy,
        count(*) filter (where t."serviceDate" < ${claveDia(semanaFin)}::date and coalesce(t."endDate", t."serviceDate") >= ${claveDia(hoy)}::date)::int as semana,
        count(*) filter (where t.status = 'PENDING')::int as pendientes,
        count(*) filter (where t.status = 'CONFIRMED' and coalesce(t."endDate", t."serviceDate") >= ${claveDia(hoy)}::date
          and not exists (select 1 from "SpecialTripAssignment" a where a."tripId" = t.id))::int as sinnave,
        count(*)::int as total
      from "SpecialTrip" t`
  ]);
  const naves = new Map(vehicles.map((v) => [v.id, v.name]));
  const meses = mesesConViajes(dias.map((d) => ({ serviceDate: d.serviceDate, count: d._count._all })));
  const n = conteos[0] ?? { hoy: 0, semana: 0, pendientes: 0, sinnave: 0, total: 0 };
  const numeros: Partial<Record<Vista, number>> = { hoy: n.hoy, semana: n.semana, pendientes: n.pendientes, sinNave: n.sinnave, todos: n.total };
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
  // Los títulos de mes sólo tienen sentido si las filas vienen por fecha.
  const porMes = orden.columna === "fecha";
  const grupos = porMes ? agruparPorMes(trips) : [{ clave: "todos", fecha: hoy, items: trips }];
  const encabezado = (columna: Columna) => (
    <EncabezadoOrdenable etiqueta={ETIQUETAS[columna]} columna={columna} orden={orden} base={base} params={params} clavePagina="pagina" />
  );

  return <AdminShell title="Viajes especiales" role={user.role} action={<div className="inline-actions">
    <Link href={`${base}/importar`} className="ghost-button">Importar historial</Link>
    <Link href={`${base}/nuevo`} className="button">Nuevo viaje</Link>
  </div>}>
    <section className="plain-card admin-section">
      <ul className="vesp-vistas" aria-label="Vistas rápidas">
        {(Object.keys(vistas) as Vista[]).map((v) => <li key={v}>
          <Link href={url({ vista: v, mes: "", pagina: "" })} className={`dia-chip${v === vista && !filtroMes ? " activo" : ""}`}
            aria-current={v === vista && !filtroMes ? "page" : undefined} data-alerta={(v === "sinNave" || v === "pendientes") && !!numeros[v]}>
            {vistas[v]}{numeros[v] !== undefined && <small>{numeros[v]}</small>}
          </Link>
        </li>)}
      </ul>
      {/* En el celular los filtros se pliegan; la casilla (sin JS) los deja abiertos si hay alguno activo. */}
      <input className="vesp-filtros-toggle" id="vesp-filtros-toggle" type="checkbox" defaultChecked={Boolean(q || status || vehicleId || mes)} />
      <label className="vesp-filtros-summary" htmlFor="vesp-filtros-toggle">
        Filtros{q || status || vehicleId || mes ? <span className="vesp-filtros-activos">activos</span> : null}
      </label>
      <form method="get" className="admin-form-grid vesp-filtros">
        <input type="hidden" name="vista" value={vista} />
        {/* Filtrar no pierde un orden elegido a mano; sin él, manda el sentido de la vista. */}
        {ordenElegido && <OrdenOculto orden={orden} />}
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
        {porMes
          ? <span>{orden.direccion === "asc" ? "Del más próximo al más lejano" : "Del más reciente al más antiguo"}</span>
          : <span>Por {ETIQUETAS[orden.columna].toLowerCase()}, {orden.direccion === "asc" ? "de menor a mayor" : "de mayor a menor"}</span>}
      </p>
      {!!trips.length && <div className="table-scroll"><table className="data-table vesp-tabla">
        <thead><tr>{encabezado("fecha")}{encabezado("cliente")}{encabezado("destino")}{encabezado("pax")}<th>Nave</th>{encabezado("estado")}<th>Acciones</th></tr></thead>
        {grupos.map((grupo) => <tbody key={grupo.clave} className="vesp-grupo">
          {porMes && (grupos.length > 1 || filtroMes === null) && <tr className="vesp-grupo-titulo"><th colSpan={7} scope="rowgroup">{etiquetaGrupo(grupo.fecha)}</th></tr>}
          {grupo.items.map((trip) => {
            const asignadas = [...new Set(trip.assignments.map((a) => naves.get(a.vehicleId) ?? "Nave"))];
            const estado = tonoFila(trip, asignadas.length > 0, hoy);
            const pendientes = pendientesDe(trip, asignadas.length > 0);
            return <tr key={trip.id} data-pendientes={pendientes.length > 0 || undefined}>
              <td className="vesp-num" data-label="Fecha" data-hoy={claveDia(trip.serviceDate) === claveDia(hoy) || Boolean(estadoDelDia(trip, hoy))}>
                {esDeVariosDias(trip)
                  ? <>{etiquetaRango(trip, hoy)}<small className="vesp-rango">{estadoDelDia(trip, hoy) ?? `${cantidadDias(trip)} días`}</small></>
                  : <>{etiquetaRelativa(trip.serviceDate, hoy) && <strong>{etiquetaRelativa(trip.serviceDate, hoy)} · </strong>}{etiquetaFecha(trip.serviceDate, hoy)}</>}
              </td>
              <td className="vesp-cliente" data-label="Cliente"><Link href={`${base}/${trip.id}`}>{trip.client}</Link>{trip.contact && <small>{trip.contact}</small>}</td>
              <td data-label="Destino o servicio">{trip.destinationSearch.replaceAll("\n", " · ")}</td>
              <td className="vesp-num" data-label="Pax">{trip.passengers ?? "—"}</td>
              <td className="vesp-nave" data-label="Nave">{asignadas.length ? <strong>{asignadas.join(", ")}</strong> : "Sin nave"}</td>
              <td data-label="Estado">
                <span className="pill pill-estado" data-tono={estado.tono}>{estado.label}</span>
                {pendientes.length > 0 && <small className="vesp-falta">Falta: {pendientes.join(", ")}</small>}
              </td>
              <td data-label="Acciones"><Link className="table-link" href={`${base}/${trip.id}/editar`}>Editar</Link></td>
            </tr>;
          })}
        </tbody>)}
      </table></div>}
      <Paginador page={page} totalPages={Math.max(1, Math.ceil(count / porPagina))} total={count} desde={desde} hasta={hasta}
        hrefPagina={(n) => url({ pagina: n > 1 ? String(n) : "" })} etiqueta="viajes" />
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
