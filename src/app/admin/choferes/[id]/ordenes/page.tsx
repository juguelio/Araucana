import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { RouteSheetDocument } from "@/components/route-sheet";
import { CabeceraOrden, ServiceOrderSheet } from "@/components/service-order-sheet";
import { fechaDeLaOrden, horaEnSalta } from "@/lib/airport/service-order";
import { getCurrentDriverManagerOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { listDriverServiceOrders } from "@/lib/driver/service-orders";
import { localDateKey } from "@/lib/operations/day-board";
import { argentina, dateOnly, legSchema, localDateTime, pointsForLeg, tripContactLabel } from "@/lib/special-trips/data";
import { ServicePrintSelection } from "@/components/service-print-selection";
import "./ordenes.css";

export const metadata = {
  title: "Órdenes de servicio por chofer · La Araucana",
  robots: { index: false, follow: false }
};

type SpecialOrder = Extract<Awaited<ReturnType<typeof listDriverServiceOrders>>[number], { type: "special" }>;

const formatDateTime = (date: Date, timeZone = argentina) => new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short", timeStyle: "short", timeZone
}).format(date);

function horarioDelTramo(value: string, zone: string) {
  const time = localDateTime(value, zone);
  return time ? formatDateTime(time, zone) : value;
}

function SpecialOrderSheet({ order, driver, date }: { order: SpecialOrder; driver: string; date: string }) {
  const { assignment: { trip, vehicle, startsAt, endsAt } } = order;
  const legs = Array.isArray(trip.legs) ? trip.legs.flatMap((value) => {
    const leg = legSchema.safeParse(value);
    return leg.success ? [leg.data] : [];
  }) : [];
  const contact = tripContactLabel(trip);
  return (
    <article className="orden">
      <CabeceraOrden fecha={fechaDeLaOrden(date)} subtitulo="Viaje especial" />
      <h2 className="orden-bloque-titulo">{trip.client}</h2>
      <dl className="orden-especial-datos">
        <div><dt>Chofer</dt><dd>{driver}</dd></div>
        <div><dt>Nave</dt><dd>{vehicle.name}</dd></div>
        <div><dt>Inicio de la asignación</dt><dd>{formatDateTime(startsAt)}</dd></div>
        <div><dt>Fin de la asignación</dt><dd>{formatDateTime(endsAt)}</dd></div>
        <div><dt>Pasajeros del viaje</dt><dd>{trip.passengers ?? "Sin cargar"}</dd></div>
        <div><dt>Contacto</dt><dd>{contact || "Sin cargar"}</dd></div>
      </dl>
      <h3>Itinerario</h3>
      {legs.length ? (
        <ol className="orden-especial-tramos">
          {legs.map((leg, index) => {
            const points = pointsForLeg(leg);
            return (
              <li key={index}>
                <strong>{[leg.origin, leg.destination].filter(Boolean).join(" → ") || `Tramo ${index + 1}`}</strong>
                {leg.departure ? <div>Salida · {horarioDelTramo(leg.departure, leg.zone)}</div> : null}
                {leg.arrival ? <div>Llegada · {horarioDelTramo(leg.arrival, leg.arrivalZone ?? leg.zone)}</div> : null}
                {points.length ? (
                  <ul aria-label="Puntos intermedios">
                    {points.map((point, i) => <li key={i}>{point.name}{point.date ? ` · ${point.date.split("-").reverse().join("/")}` : null}</li>)}
                  </ul>
                ) : null}
                {leg.description ? <p className="orden-especial-notas">{leg.description}</p> : null}
              </li>
            );
          })}
        </ol>
      ) : <p className="orden-especial-notas">{trip.destinationSearch.trim() || "Sin itinerario cargado."}</p>}
      {trip.notes ? <p className="orden-especial-notas"><strong>Notas</strong> · {trip.notes}</p> : null}
    </article>
  );
}

export default async function DriverOrdersPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fecha?: string | string[] }>;
}) {
  const actor = await getCurrentDriverManagerOrRedirect();
  const [{ id }, { fecha }] = await Promise.all([params, searchParams]);
  const date = typeof fecha === "string" && dateOnly(fecha) ? fecha : localDateKey(new Date());
  const driver = await prisma.user.findFirst({
    where: { id, role: "DRIVER" },
    select: { id: true, name: true, email: true }
  });
  if (!driver) notFound();

  const driverName = driver.name?.trim() || driver.email;
  const driverHref = `/admin/choferes/${driver.id}`;
  const orders = await listDriverServiceOrders(driver.id, date);

  const documents = orders.map((order) => {
    const id = `${order.type}-${order.id}`;
    const time = horaEnSalta(order.at);
    switch (order.type) {
      case "airport":
        return {
          id, title: `${order.block.direction === "ARRIVAL" ? "IN" : "OUT"} · ${order.block.flightNumber}`,
          detail: `${time} · ${order.block.vehicle?.name ?? "Aeropuerto"}`,
          content: <ServiceOrderSheet date={date} blocks={[order.block]} variante="chofer" mostrarResumen={false} />
        };
      case "special":
        return {
          id, title: order.assignment.trip.client,
          detail: `Viaje especial · ${time} · ${order.assignment.vehicle.name}`,
          content: <SpecialOrderSheet order={order} driver={driverName} date={date} />
        };
      case "route":
        return {
          id, title: order.sheet.routeShortLabel,
          detail: `Servicio público · ${time} · ${order.vehicles.join(" + ")}`,
          content: <RouteSheetDocument sheet={order.sheet} assignment={`Nave asignada: ${order.vehicles.join(" + ")}`} />
        };
    }
  });

  return (
    <AdminShell title="Hoja del chofer" eyebrow={driverName} role={actor.role}
      action={<div className="inline-actions">
        <Link className="ghost-button" href="/admin/choferes">Volver a choferes</Link>
        <Link className="ghost-button" href={`${driverHref}/actividad`}>Ver actividad</Link>
      </div>}>
      <div className="driver-orders">
        <div className="driver-orders-controls inline-actions no-print">
          <form action={`${driverHref}/ordenes`} className="inline-actions">
            <label>Fecha del servicio<input type="date" name="fecha" defaultValue={date} required /></label>
            <button className="ghost-button" type="submit">Ver órdenes</button>
          </form>
        </div>
        {documents.length ? (
          <ServicePrintSelection key={JSON.stringify([driver.id, date, documents.map(({ id }) => id)])} documents={documents} />
        ) : <p className="plain-card admin-section">No hay servicios asignados a este chofer en la fecha elegida.</p>}
      </div>
    </AdminShell>
  );
}
