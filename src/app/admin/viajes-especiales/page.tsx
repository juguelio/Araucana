import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { dateOnly, localInput, statuses } from "@/lib/special-trips/data";
import { dayInterval } from "@/lib/special-trips/conflicts";

const base = "/admin/viajes-especiales";
const dayMs = 86_400_000;

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
  const week = dateOnly(value("semana")) ?? dateOnly(localInput(new Date()).slice(0, 10))!;
  const weekKey = (days: number) => new Date(+week + days * dayMs).toISOString().slice(0, 10);
  const { startsAt } = dayInterval(weekKey(0));
  const { startsAt: endsAt } = dayInterval(weekKey(7));
  const filterDate = dateOnly(value("fecha"));
  const status = value("estado");
  const vehicleId = value("nave");
  const where: Prisma.SpecialTripWhereInput = {
    ...(filterDate && { serviceDate: filterDate }),
    ...(Object.hasOwn(statuses, status) && { status }),
    ...(value("cliente") && { client: { contains: value("cliente"), mode: "insensitive" } }),
    ...(value("destino") && { destinationSearch: { contains: value("destino"), mode: "insensitive" } }),
    ...(vehicleId && { assignments: { some: { vehicleId } } })
  };
  const page = Math.min(10000, Math.max(1, Number.parseInt(value("pagina"), 10) || 1));
  const [vehicles, trips, count, agenda, unassigned] = await Promise.all([
    prisma.vehicle.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.specialTrip.findMany({ where, skip: (page - 1) * 50, take: 50, orderBy: [{ serviceDate: "desc" }, { id: "asc" }] }),
    prisma.specialTrip.count({ where }),
    prisma.specialTripAssignment.findMany({
      where: { startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, trip: { status: { not: "CANCELLED" } }, ...(vehicleId && { vehicleId }) },
      orderBy: { startsAt: "asc" }, include: { trip: { select: { client: true, status: true } } }
    }),
    prisma.specialTrip.findMany({
      where: { status: "CONFIRMED", serviceDate: { gte: week, lt: dateOnly(weekKey(7))! }, assignments: { none: {} } },
      orderBy: { serviceDate: "asc" }
    })
  ]);
  const url = (changes: Record<string, string>) => {
    const query = new URLSearchParams();
    for (const key of ["semana", "fecha", "estado", "nave", "cliente", "destino", "pagina"]) {
      const selected = changes[key] ?? value(key);
      if (selected) query.set(key, selected);
    }
    return `${base}?${query}`;
  };

  return <AdminShell title="Viajes especiales" role={user.role} action={<div className="inline-actions">
    <Link href={`${base}/importar`} className="ghost-button">Importar historial</Link>
    <Link href={`${base}/nuevo`} className="button">Nuevo viaje</Link>
  </div>}>
    <section className="plain-card admin-section">
      <h2>Agenda por nave</h2>
      <p>Del {weekKey(0)} al {weekKey(6)} · Hora argentina</p>
      <div className="inline-actions">
        <Link href={url({ semana: weekKey(-7) })}>Semana anterior</Link>
        <Link href={url({ semana: weekKey(7) })}>Semana siguiente</Link>
      </div>
      <form method="get" className="inline-actions">
        <label>Empezar la semana el <input type="date" name="semana" defaultValue={weekKey(0)} required /></label>
        {["fecha", "estado", "cliente", "destino", "nave"].map((key) => <input key={key} type="hidden" name={key} value={value(key)} />)}
        <button className="ghost-button">Ver semana</button>
      </form>
      {vehicles.filter((v) => agenda.some((a) => a.vehicleId === v.id)).map((vehicle) => <section key={vehicle.id}>
        <h3>{vehicle.name}</h3>
        <ul>{agenda.filter((a) => a.vehicleId === vehicle.id).map((a) => <li key={a.id}>
          <Link href={`${base}/${a.tripId}`}>{a.trip.client}</Link> · {localInput(a.startsAt).replace("T", " ")} → {localInput(a.endsAt).replace("T", " ")} · {duration(a.startsAt, a.endsAt)} · {statuses[a.trip.status as keyof typeof statuses]}
        </li>)}</ul>
      </section>)}
      {!agenda.length && <p>Sin ocupaciones de viajes especiales en esta semana.</p>}
      <h3>Pendientes de asignación</h3>
      {unassigned.length ? <ul>{unassigned.map((trip) => <li key={trip.id}><Link href={`${base}/${trip.id}`}>{trip.client}</Link> · {trip.serviceDate.toISOString().slice(0, 10)}</li>)}</ul> : <p>Sin viajes confirmados pendientes de asignación.</p>}
    </section>
    <section className="plain-card admin-section">
      <h2>Listado de viajes</h2>
      <form method="get" className="admin-form-grid">
        <input type="hidden" name="semana" value={weekKey(0)} />
        <label>Fecha<input type="date" name="fecha" defaultValue={value("fecha")} /></label>
        <label>Estado<select name="estado" defaultValue={status}><option value="">Todos</option>{Object.entries(statuses).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label>Cliente<input name="cliente" defaultValue={value("cliente")} /></label>
        <label>Destino<input name="destino" defaultValue={value("destino")} /></label>
        <label>Nave<select name="nave" defaultValue={vehicleId}><option value="">Todas</option>{vehicles.map((v) => <option value={v.id} key={v.id}>{v.name}</option>)}</select></label>
        <button className="ghost-button">Filtrar</button>
      </form>
      <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Fecha</th><th>Cliente</th><th>Destino o servicio</th><th>Estado</th></tr></thead>
        <tbody>{trips.map((trip) => <tr key={trip.id}>
          <td>{trip.serviceDate.toISOString().slice(0, 10)}</td>
          <td><Link href={`${base}/${trip.id}`}>{trip.client}</Link></td>
          <td>{trip.destinationSearch.replaceAll("\n", " · ")}</td>
          <td>{statuses[trip.status as keyof typeof statuses]}</td>
        </tr>)}</tbody>
      </table></div>
      {!trips.length && <p>Sin viajes para estos filtros.</p>}
      <p>{count} viajes</p>
      <div className="inline-actions">
        {page > 1 && <Link href={url({ pagina: String(page - 1) })}>Página anterior</Link>}
        {page * 50 < count && <Link href={url({ pagina: String(page + 1) })}>Página siguiente</Link>}
      </div>
    </section>
  </AdminShell>;
}
