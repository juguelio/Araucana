import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import {
  argentina, billingModes, legSchema, MAX_TRIP_PAYMENTS, parseMoney, paymentKinds, paymentSchema,
  pointsForLeg, statuses, tripContactLabel, tripPaymentTotals
} from "@/lib/special-trips/data";
import { parseTripLegs, planillaKindsForSpecialTrip } from "@/lib/departure-sheets/applicability";
import { listDepartureSheetsForSpecialTrip } from "@/lib/departure-sheets/repository";
import { PlanillasSection } from "./planillas-section";
import { cadenaDeDias, cantidadDias, esDeVariosDias, estadoDelDia, etiquetaRango, etiquetaRangoLarga, motivoParaNoUnir, ultimoDia } from "@/lib/special-trips/rango";
import { dateOnly, localInput } from "@/lib/special-trips/data";
import { unirViajesAction } from "../unir-actions";
import { TripPaymentForm } from "../trip-payment-form";
import "./ficha.css";

const dateFormat = new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "UTC" });
const weekdayFormat = new Intl.DateTimeFormat("es-AR", { weekday: "long", timeZone: "UTC" });
const shortDateTime = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: argentina });

/** «2027-02-01T10:00» (hora local del tramo) → «1 feb, 10:00». Si no es ese formato, se muestra tal cual. */
function horaTramo(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  const [, y, m, d, hh, mm] = match;
  const dia = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${y}-${m}-${d}T00:00:00Z`));
  return `${dia}, ${hh}:${mm}`;
}

const capitalizar = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);
const tonoEstado: Record<string, string> = { PENDING: "atencion", CONFIRMED: "ok", COMPLETED: "normal", CANCELLED: "normal" };
const paises: Record<string, string> = { AR: "Argentina", CL: "Chile", AR_CL: "Argentina y Chile" };

export default async function TripPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ guardado?: string; planilla?: string; aviso?: string; cobro?: string }> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const [{ id }, { guardado, planilla, aviso, cobro }] = await Promise.all([params, searchParams]);
  const trip = await prisma.specialTrip.findUnique({
    where: { id },
    include: {
      assignments: {
        orderBy: { startsAt: "asc" },
        include: { vehicle: { select: { name: true } }, driver: { select: { name: true, email: true } } }
      },
      sources: { orderBy: [{ sheet: "asc" }, { row: "asc" }] }
    }
  });
  if (!trip) notFound();
  const legs = z.array(legSchema).safeParse(trip.legs).data ?? [];
  // Varios días: el viaje figura en cada día del rango. Y si la planilla lo cargó un renglón por día
  // (mismo cliente, mismo servicio, días seguidos), se ofrece unirlo.
  const hoy = dateOnly(localInput(new Date()).slice(0, 10))!;
  const variosDias = esDeVariosDias(trip);
  const estadoHoy = estadoDelDia(trip, hoy);
  const vecinos = await prisma.specialTrip.findMany({
    where: {
      id: { not: trip.id }, status: { not: "CANCELLED" },
      client: { equals: trip.client.trim(), mode: "insensitive" },
      serviceDate: { gte: new Date(+trip.serviceDate - 62 * 86_400_000), lte: new Date(+ultimoDia(trip) + 62 * 86_400_000) }
    },
    select: { id: true, client: true, destinationSearch: true, serviceDate: true, endDate: true, status: true, totalCents: true, payments: true, _count: { select: { assignments: true, departureSheets: true } } }
  });
  const cadena = cadenaDeDias({ ...trip, _count: { assignments: trip.assignments.length, departureSheets: 0 } }, vecinos as typeof vecinos);
  const noUnir = cadena.length ? motivoParaNoUnir(cadena.slice(1).map((t) => ({
    totalCents: t.totalCents, payments: t.payments, assignments: t._count.assignments, planillas: t._count.departureSheets, client: t.client
  }))) : null;
  const cadenaRango = cadena.length ? { serviceDate: cadena[0].serviceDate, endDate: cadena.reduce((max, t) => +ultimoDia(t) > +max ? ultimoDia(t) : max, ultimoDia(cadena[0])) } : null;
  // Naves que quedan libres antes de que el viaje vuelva: el tablero las mostraría disponibles.
  const ultimoDiaClave = ultimoDia(trip).toISOString().slice(0, 10);
  const navesCortas = variosDias ? trip.assignments.filter((a) => localInput(a.startsAt).slice(0, 10) > trip.serviceDate.toISOString().slice(0, 10) || localInput(a.endsAt).slice(0, 10) < ultimoDiaClave) : [];
  const departureSheets = await listDepartureSheetsForSpecialTrip(trip.id);
  const planillaKinds = planillaKindsForSpecialTrip({
    destinationSearch: trip.destinationSearch,
    legs: parseTripLegs(trip.legs)
  });
  const payments = z.array(paymentSchema).safeParse(trip.payments).data ?? [];
  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: trip.currency });
  const total = trip.totalCents === null ? "Por confirmar" : money.format(trip.totalCents / 100);
  const { paid, balance } = tripPaymentTotals(trip.totalCents, payments);
  const contact = tripContactLabel(trip);

  const estadoTexto = statuses[trip.status as keyof typeof statuses] ?? trip.status;
  const sinNave = trip.assignments.length === 0 && trip.status !== "CANCELLED" && trip.status !== "COMPLETED";
  const sinPrecio = trip.totalCents === null && trip.billingMode !== "INCLUDED";
  // Lo que todavía no está cargado, para no tener que recorrer la ficha buscándolo.
  const faltan = [
    sinNave ? { href: "#naves", texto: "nave y chofer" } : null,
    sinPrecio ? { href: "#facturacion", texto: "precio" } : null,
    !contact ? { href: `/admin/viajes-especiales/${id}/editar`, texto: "contacto" } : null,
    trip.passengers === null ? { href: `/admin/viajes-especiales/${id}/editar`, texto: "cantidad de pasajeros" } : null,
    legs.length === 0 ? { href: `/admin/viajes-especiales/${id}/editar`, texto: "itinerario" } : null
  ].filter((f): f is { href: string; texto: string } => f !== null);

  return (
    <AdminShell title={trip.client} eyebrow="Viaje especial" role={user.role}
      notice={aviso ? decodeURIComponent(aviso) : planilla ? decodeURIComponent(planilla) : cobro ? "Cobro registrado." : guardado ? "Viaje guardado." : undefined}
      action={<div className="inline-actions">
        <Link className="ghost-button" href="/admin/viajes-especiales">Volver a Viajes especiales</Link>
        <Link className="ghost-button" href={`/admin/viajes-especiales/${id}/orden-de-servicio`}>Orden de servicio</Link>
        <Link className="button" href={`/admin/viajes-especiales/${id}/editar`}>Editar viaje</Link>
      </div>}>
      {/* Cabecera: lo que se consulta de un vistazo. Los mismos datos que abajo, resumidos. */}
      <header className="viaje-cabecera">
        <div className="viaje-cabecera-fecha">
          {variosDias ? <>
            <span className="viaje-dia-semana">{cantidadDias(trip)} días{estadoHoy ? ` · ${estadoHoy}` : ""}</span>
            <strong>{capitalizar(etiquetaRangoLarga(trip))}</strong>
          </> : <>
            <span className="viaje-dia-semana">{weekdayFormat.format(trip.serviceDate)}</span>
            <strong>{capitalizar(dateFormat.format(trip.serviceDate))}</strong>
          </>}
        </div>
        <div className="viaje-cabecera-datos">
          <span className="pill pill-estado" data-tono={tonoEstado[trip.status] ?? "normal"}>{estadoTexto}</span>
          <span className="viaje-dato"><strong>{trip.passengers ?? "—"}</strong> pasajeros</span>
          <span className="viaje-dato"><strong>{total}</strong></span>
          {trip.contactName || trip.contactPhone ? (
            <span className="viaje-dato viaje-contacto">
              {trip.contactName}{trip.contactName && trip.contactPhone ? " · " : ""}
              {trip.contactPhone ? <a href={`tel:${trip.contactPhone.replace(/[^+\d]/g, "")}`}>{trip.contactPhone}</a> : null}
            </span>
          ) : trip.contact ? <span className="viaje-dato viaje-contacto">{trip.contact}</span> : null}
        </div>
        {faltan.length > 0 ? (
          <p className="viaje-faltan">
            <span>Falta:</span>
            {faltan.map((f, i) => (
              <Link key={f.texto} href={f.href}>{f.texto}{i < faltan.length - 1 ? "," : ""}</Link>
            ))}
          </p>
        ) : null}
      </header>

      {cadena.length > 1 && cadenaRango ? (
        <section className="plain-card admin-section viaje-unir" aria-label="Mismo viaje cargado por día">
          <h2>¿Es un solo viaje de {cantidadDias(cadenaRango)} días?</h2>
          <p>
            La planilla lo cargó un renglón por día: {cadena.length} viajes de <strong>{trip.client}</strong> con el mismo servicio,{" "}
            {etiquetaRangoLarga(cadenaRango).replace(/^Del /, "del ")}.
            {" "}Si es el mismo viaje, unilo y va a figurar como un bloque en cada día, con la nave y el chofer ocupados todo el período.
          </p>
          <ul className="viaje-unir-dias">{cadena.map((t) => (
            <li key={t.id} aria-current={t.id === trip.id ? "true" : undefined}>
              {t.id === trip.id ? <strong>{etiquetaRango({ serviceDate: t.serviceDate }, hoy)} (este)</strong> : <Link href={`/admin/viajes-especiales/${t.id}`}>{etiquetaRango({ serviceDate: t.serviceDate }, hoy)}</Link>}
            </li>
          ))}</ul>
          {noUnir ? <p className="viaje-unir-no">No se une solo: {noUnir.charAt(0).toLowerCase() + noUnir.slice(1)} Si igual es un único viaje, cargá la vuelta en el primero y cancelá los otros.</p> : (
            <form action={unirViajesAction}>
              {cadena.map((t) => <input key={t.id} type="hidden" name="ids" value={t.id} />)}
              <button className="button" type="submit">Unir en un viaje · {etiquetaRangoLarga(cadenaRango).replace(/^Del /, "del ")}</button>
              <p className="muted">Queda el primer día con su importe y sus datos; los otros {cadena.length - 1} renglones se borran y sus filas de la planilla pasan a este viaje.</p>
            </form>
          )}
        </section>
      ) : null}

      <div className="viaje-columnas">
        <div className="viaje-principal">
          <section className="plain-card admin-section" id="itinerario">
            <h2>Itinerario</h2>
            {legs.length ? (
              <ol className="viaje-tramos">
                {legs.map((leg, index) => (
                  <li key={index} className="viaje-tramo">
                    <span className="viaje-tramo-numero" aria-hidden="true">{index + 1}</span>
                    <div className="viaje-tramo-cuerpo">
                      <h3>{[leg.origin, leg.destination].filter(Boolean).join(" → ") || `Tramo ${index + 1}`}</h3>
                      <p className="viaje-tramo-meta">
                        {leg.departure ? <span>Sale {horaTramo(leg.departure)}</span> : null}
                        {leg.arrival ? <span>Llega {horaTramo(leg.arrival)}</span> : null}
                        {leg.country !== "AR" ? <span>{paises[leg.country] ?? leg.country}</span> : null}
                        {leg.included ? <span>Incluido</span> : null}
                      </p>
                      {pointsForLeg(leg).length > 0 ? (
                        <ul className="viaje-puntos" aria-label="Puntos intermedios">{pointsForLeg(leg).map((point, pointIndex) => {
                          const amount = parseMoney(point.amount);
                          return <li key={pointIndex}>
                            {point.name}{point.date ? ` · ${point.date.split("-").reverse().join("/")}` : ""}
                            {amount === null ? "" : ` · ${money.format(amount / 100)}`}
                          </li>;
                        })}</ul>
                      ) : null}
                      {leg.description ? <p className="viaje-tramo-descripcion">{leg.description}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="muted">{trip.destinationSearch.replaceAll("\n", " · ") || "Sin itinerario cargado."}</p>}
            {trip.notes ? <p className="viaje-notas"><strong>Notas:</strong> {trip.notes}</p> : null}
          </section>

          <PlanillasSection tripId={trip.id} sheets={departureSheets} kinds={planillaKinds} />

          {trip.sources.length > 0 ? <section className="plain-card admin-section">
            <h2>Filas de origen</h2>
            <p className="muted">De dónde salió este viaje en la planilla importada.</p>
            {trip.sources.map((source) => <details key={source.id} className="viaje-origen">
              <summary>{source.sheet} · fila {source.row}</summary>
              {Array.isArray(source.issues) && source.issues.map((issue, index) => <p key={index}>{String(issue)}</p>)}
              {Array.isArray(source.original) && <p className="muted">{source.original.map((cell) => String(cell ?? "")).join(" · ")}</p>}
            </details>)}
          </section> : null}
        </div>

        <aside className="viaje-lateral">
          <section className="plain-card admin-section" id="naves" data-falta={sinNave || undefined}>
            <h2>Naves y choferes</h2>
            {navesCortas.length ? <p className="viaje-aviso-naves">
              {navesCortas.map((a) => a.vehicle.name).join(", ")} no {navesCortas.length === 1 ? "queda ocupada" : "quedan ocupadas"} los {cantidadDias(trip)} días del viaje: en el tablero {navesCortas.length === 1 ? "aparece libre" : "aparecen libres"} mientras está afuera.{" "}
              <Link className="table-link" href={`/admin/viajes-especiales/${id}/editar`}>Corregir</Link>
            </p> : null}
            {trip.assignments.length ? <ul className="viaje-asignaciones">{trip.assignments.map((assignment) => (
              <li key={assignment.id}>
                <strong>{assignment.vehicle.name}</strong>
                <span>{assignment.driver?.name ?? assignment.driver?.email ?? "Sin chofer"}</span>
                <span className="muted">{shortDateTime.format(assignment.startsAt)} → {shortDateTime.format(assignment.endsAt)}</span>
              </li>
            ))}</ul> : (
              <p className="muted">
                Sin nave asignada.{sinNave ? <> <Link className="table-link" href={`/admin/viajes-especiales/${id}/editar`}>Asignar</Link></> : null}
              </p>
            )}
          </section>

          <section className="plain-card admin-section" id="facturacion" data-falta={sinPrecio || undefined}>
            <h2>Facturación</h2>
            <div className="summary-list viaje-resumen">
              <div><span>Modalidad</span><strong>{billingModes[trip.billingMode as keyof typeof billingModes] ?? trip.billingMode}</strong></div>
              <div><span>Total</span><strong>{total}</strong></div>
              <div><span>Cobrado</span><strong>{money.format(paid / 100)}</strong></div>
              <div><span>{balance !== null && balance < 0 ? "Saldo a favor" : "Saldo pendiente"}</span><strong>{balance === null ? "Por determinar" : money.format(Math.abs(balance) / 100)}</strong></div>
              {trip.paymentStatus ? <div><span>Nota de pago</span><strong>{trip.paymentStatus}</strong></div> : null}
              {trip.supplier ? <div><span>Proveedor</span><strong>{trip.supplier}</strong></div> : null}
              {trip.invoice ? <div><span>Factura</span><strong>{trip.invoice}{trip.invoiceDate ? ` · ${dateFormat.format(trip.invoiceDate)}` : ""}</strong></div> : null}
            </div>
            {payments.length ? (
              <>
                <h3 className="viaje-subtitulo">Cobros</h3>
                <ul className="viaje-cobros">{payments.map((payment, index) => {
                  const cents = parseMoney(payment.amount);
                  return <li key={payment.id ?? index}>
                    <span>{payment.kind ? paymentKinds[payment.kind] : "Cobro"}{payment.date ? ` · ${payment.date.split("-").reverse().join("/")}` : ""}</span>
                    <strong>{cents === null ? payment.amount || "—" : money.format(cents / 100)}</strong>
                    {payment.note ? <span className="muted">{payment.note}</span> : null}
                  </li>;
                })}</ul>
              </>
            ) : null}
            {(balance === null || balance > 0) && payments.length < MAX_TRIP_PAYMENTS
              ? <TripPaymentForm key={trip.updatedAt.toISOString()} tripId={id} operationId={randomUUID()} currency={trip.currency} today={hoy.toISOString().slice(0, 10)} />
              : null}
          </section>
        </aside>
      </div>
    </AdminShell>
  );
}
