import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { argentina, billingModes, legSchema, paymentSchema, statuses } from "@/lib/special-trips/data";
import { parseTripLegs, planillaKindsForSpecialTrip } from "@/lib/departure-sheets/applicability";
import { listDepartureSheetsForSpecialTrip } from "@/lib/departure-sheets/repository";
import { PlanillasSection } from "./planillas-section";
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

export default async function TripPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ guardado?: string; planilla?: string }> }) {
  const user = await getCurrentReservationsUserOrRedirect();
  const [{ id }, { guardado, planilla }] = await Promise.all([params, searchParams]);
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
  const departureSheets = await listDepartureSheetsForSpecialTrip(trip.id);
  const planillaKinds = planillaKindsForSpecialTrip({
    destinationSearch: trip.destinationSearch,
    legs: parseTripLegs(trip.legs)
  });
  const payments = z.array(paymentSchema).safeParse(trip.payments).data ?? [];
  const total = trip.totalCents === null ? "Por confirmar"
    : new Intl.NumberFormat("es-AR", { style: "currency", currency: trip.currency }).format(trip.totalCents / 100);

  const estadoTexto = statuses[trip.status as keyof typeof statuses] ?? trip.status;
  const sinNave = trip.assignments.length === 0 && trip.status !== "CANCELLED" && trip.status !== "COMPLETED";
  const sinPrecio = trip.totalCents === null && trip.billingMode !== "INCLUDED";
  // Lo que todavía no está cargado, para no tener que recorrer la ficha buscándolo.
  const faltan = [
    sinNave ? { href: "#naves", texto: "nave y chofer" } : null,
    sinPrecio ? { href: "#facturacion", texto: "precio" } : null,
    !trip.contact ? { href: `/admin/viajes-especiales/${id}/editar`, texto: "contacto" } : null,
    trip.passengers === null ? { href: `/admin/viajes-especiales/${id}/editar`, texto: "cantidad de pasajeros" } : null,
    legs.length === 0 ? { href: `/admin/viajes-especiales/${id}/editar`, texto: "itinerario" } : null
  ].filter((f): f is { href: string; texto: string } => f !== null);

  return (
    <AdminShell title={trip.client} eyebrow="Viaje especial" role={user.role}
      notice={planilla ? decodeURIComponent(planilla) : guardado ? "Viaje guardado." : undefined}
      action={<div className="inline-actions">
        <Link className="ghost-button" href="/admin/viajes-especiales">Volver a Viajes especiales</Link>
        <Link className="button" href={`/admin/viajes-especiales/${id}/editar`}>Editar viaje</Link>
      </div>}>
      {/* Cabecera: lo que se consulta de un vistazo. Los mismos datos que abajo, resumidos. */}
      <header className="viaje-cabecera">
        <div className="viaje-cabecera-fecha">
          <span className="viaje-dia-semana">{weekdayFormat.format(trip.serviceDate)}</span>
          <strong>{capitalizar(dateFormat.format(trip.serviceDate))}</strong>
        </div>
        <div className="viaje-cabecera-datos">
          <span className="pill pill-estado" data-tono={tonoEstado[trip.status] ?? "normal"}>{estadoTexto}</span>
          <span className="viaje-dato"><strong>{trip.passengers ?? "—"}</strong> pasajeros</span>
          <span className="viaje-dato"><strong>{total}</strong></span>
          {trip.contact ? <span className="viaje-dato viaje-contacto">{trip.contact}</span> : null}
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
                      {leg.stops ? <p className="muted">Paradas: {leg.stops}</p> : null}
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
              {trip.paymentStatus ? <div><span>Pago</span><strong>{trip.paymentStatus}</strong></div> : null}
              {trip.supplier ? <div><span>Proveedor</span><strong>{trip.supplier}</strong></div> : null}
              {trip.invoice ? <div><span>Factura</span><strong>{trip.invoice}{trip.invoiceDate ? ` · ${dateFormat.format(trip.invoiceDate)}` : ""}</strong></div> : null}
            </div>
            {payments.length ? (
              <>
                <h3 className="viaje-subtitulo">Cobros</h3>
                <ul className="viaje-cobros">{payments.map((payment, index) => (
                  <li key={index}>
                    <span>{payment.date || "—"}</span>
                    <strong>{payment.amount || "—"}</strong>
                    {payment.note ? <span className="muted">{payment.note}</span> : null}
                  </li>
                ))}</ul>
              </>
            ) : null}
          </section>
        </aside>
      </div>
    </AdminShell>
  );
}
