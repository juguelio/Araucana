import { AdminShell } from "@/components/admin-shell";
import { FLIGHT_STATUSES, needsAttention, statusDetail, statusLabel } from "@/lib/airport/flights";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { createFlightAction, deleteFlightAction, refreshFlightsAction, updateFlightAction } from "./actions";
import { FlightForm } from "./flight-form";

type PageProps = { searchParams?: Promise<{ notice?: string; date?: string }> };

const TZ_OFFSET_MIN = -180; // America/Argentina/Salta (-03), sin horario de verano

function diaLocal(d: Date) {
  return new Date(d.getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

function rangoDelDia(fecha: string) {
  const desde = new Date(`${fecha}T00:00:00.000-03:00`);
  return { desde, hasta: new Date(desde.getTime() + 24 * 3600 * 1000) };
}

const hhmm = (d: Date) => new Date(d.getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(11, 16);

export default async function AirportPage({ searchParams }: PageProps) {
  await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const fecha = params?.date ?? diaLocal(new Date());
  const { desde, hasta } = rangoDelDia(fecha);

  const vuelos = await prisma.flight.findMany({
    where: { scheduledAt: { gte: desde, lt: hasta } },
    orderBy: { scheduledAt: "asc" },
    include: { events: { orderBy: { detectedAt: "desc" }, take: 1 } }
  });

  const imprevistos = vuelos.filter((v) => needsAttention({ status: v.status, scheduledAt: v.scheduledAt, estimatedAt: v.estimatedAt }));
  const conEvento = await prisma.flightEvent.findMany({
    where: { flight: { scheduledAt: { gte: desde, lt: hasta } } },
    orderBy: { detectedAt: "desc" },
    take: 8,
    include: { flight: { select: { number: true } } }
  });

  return (
    <AdminShell
      title="Aeropuerto"
      eyebrow="Operación"
      notice={params?.notice}
      action={
        <form action={refreshFlightsAction}>
          <button className="ghost-button" type="submit">Actualizar ahora</button>
        </form>
      }
    >
      <section className="admin-grid">
        <div className="admin-card"><span className="muted">Vuelos del día</span><strong>{vuelos.length}</strong></div>
        <div className="admin-card"><span className="muted">Con imprevisto</span><strong>{imprevistos.length}</strong></div>
        <div className="admin-card"><span className="muted">Arribos / partidas</span>
          <strong>{vuelos.filter((v) => v.direction === "ARRIVAL").length} / {vuelos.filter((v) => v.direction === "DEPARTURE").length}</strong>
        </div>
      </section>

      <p className="muted">
        Fecha: <strong>{fecha}</strong>. Los vuelos se van a <strong>postear automáticamente</strong> cuando esté
        conectada la fuente de datos de vuelos (falta la cuenta/clave). Hasta entonces se cargan a mano y el panel
        nunca se rompe: si no hay datos en vivo, se sigue operando con el horario cargado.
      </p>

      <table className="data-table">
        <thead>
          <tr><th>Hora</th><th>Vuelo</th><th>Dirección</th><th>Origen / destino</th><th>Estado</th><th>Pasajeros</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          {vuelos.map((v) => {
            const snapshot = { status: v.status, scheduledAt: v.scheduledAt, estimatedAt: v.estimatedAt };
            const alerta = needsAttention(snapshot);
            return (
              <tr key={v.id}>
                <td>{hhmm(v.scheduledAt)}{v.estimatedAt ? ` → ${hhmm(v.estimatedAt)}` : ""}</td>
                <td>{v.number}{v.airline ? ` · ${v.airline}` : ""}</td>
                <td>{v.direction === "ARRIVAL" ? "Arribo" : "Partida"}</td>
                <td>{v.origin}</td>
                <td>
                  {alerta ? <span className="status-dot">● {statusDetail(snapshot)}</span> : `${statusLabel(v.status)} · ${statusDetail(snapshot)}`}
                  {v.source !== "API" ? <span className="muted"> (a mano)</span> : null}
                </td>
                <td>{v.passengers ?? "—"}</td>
                <td>
                  <div className="inline-actions">
                    <form action={updateFlightAction}>
                      <input type="hidden" name="id" value={v.id} />
                      <input type="datetime-local" name="estimatedAt" title="Nueva hora estimada (para demoras/adelantos)" />
                      {(["DELAYED", "CANCELLED", "LANDED"] as const).map((s) => (
                        <button key={s} className="ghost-button" type="submit" name="status" value={s}>{statusLabel(s)}</button>
                      ))}
                    </form>
                    <form action={deleteFlightAction}>
                      <input type="hidden" name="id" value={v.id} />
                      <button className="ghost-button" type="submit">Borrar</button>
                    </form>
                  </div>
                </td>
              </tr>
            );
          })}
          {vuelos.length === 0 ? (
            <tr><td colSpan={7}>No hay vuelos cargados para {fecha}. Cargá uno abajo para empezar.</td></tr>
          ) : null}
        </tbody>
      </table>

      {conEvento.length > 0 ? (
        <>
          <h2>Imprevistos registrados</h2>
          <ul>
            {conEvento.map((e) => (
              <li key={e.id}>
                {hhmm(e.detectedAt)} · <strong>{e.flight.number}</strong> · {e.kind}
                {e.fromValue || e.toValue ? ` (${e.fromValue ?? "—"} → ${e.toValue ?? "—"})` : ""}
                {e.notifiedAt ? " · avisado" : " · sin avisar"}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <section className="plain-card admin-section">
        <h2>Cargar vuelo a mano</h2>
        <p className="muted">Estados posibles: {FLIGHT_STATUSES.map((s) => s.label).join(" · ")}.</p>
        <FlightForm action={createFlightAction} />
      </section>
    </AdminShell>
  );
}
