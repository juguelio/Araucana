import { AdminShell } from "@/components/admin-shell";
import { capacidadDeVuelo, combisSugeridas, pasajerosOcupados } from "@/lib/airport/booking";
import { FLIGHT_STATUSES, needsAttention, statusDetail, statusLabel } from "@/lib/airport/flights";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { airLabsKeyState } from "@/lib/settings/app-settings";
import { assignVehicleAction, createFlightAction, deleteFlightAction, refreshFlightsAction, removeAssignmentAction, saveAirLabsKeyAction, updateFlightAction } from "./actions";
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
  const usuario = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const fecha = params?.date ?? diaLocal(new Date());
  const { desde, hasta } = rangoDelDia(fecha);

  const vuelos = await prisma.flight.findMany({
    where: { scheduledAt: { gte: desde, lt: hasta } },
    orderBy: { scheduledAt: "asc" },
    include: {
      events: { orderBy: { detectedAt: "desc" }, take: 1 },
      reservations: { include: { reservation: { select: { passengerCount: true, status: true } } } },
      assignments: { include: { vehicle: { include: { seats: true } }, driver: { select: { name: true, email: true } } } }
    }
  });

  const naves = await prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });

  const imprevistos = vuelos.filter((v) => needsAttention({ status: v.status, scheduledAt: v.scheduledAt, estimatedAt: v.estimatedAt }));
  const conEvento = await prisma.flightEvent.findMany({
    where: { flight: { scheduledAt: { gte: desde, lt: hasta } } },
    orderBy: { detectedAt: "desc" },
    take: 8,
    include: { flight: { select: { number: true } } }
  });

  const clave = await airLabsKeyState();

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
        Fecha: <strong>{fecha}</strong>. Los vuelos se traen de <strong>dos fuentes</strong>: el servicio de datos de
        AirLabs y el <strong>tablero oficial del aeropuerto</strong> (que cubre aerolíneas que AirLabs no publica, como
        American Jet). Se refrescan con "Actualizar ahora" o el proceso programado. Si una fuente falla, el panel no se
        rompe: se sigue operando con el horario ya cargado. Los vuelos cargados a mano se marcan "(a mano)".
      </p>

      <section className="form-panel">
        <p className="eyebrow">Datos de vuelos</p>
        <h2 className="route-title">Clave de AirLabs</h2>
        <p className="muted">
          Los horarios y los estados de los vuelos los publica AirLabs. Sin clave, &quot;Actualizar ahora&quot; no
          puede traer datos nuevos.
          {clave.source === "none" ? " Ahora mismo no hay ninguna clave configurada." : null}
        </p>
        <p>
          Estado:{" "}
          <strong>{clave.source === "none" ? "sin configurar" : `configurada (${clave.masked})`}</strong>
          {clave.source === "env"
            ? " — la toma de las variables del servidor"
            : clave.source === "panel"
              ? " — cargada desde este panel"
              : ""}
        </p>
        {usuario.role === "ADMIN" ? (
          <form action={saveAirLabsKeyAction} className="checkout-fields">
            <label>
              {clave.source === "panel" ? "Reemplazar la clave" : "Pegar la clave"}
              <input name="apiKey" type="password" autoComplete="off" placeholder="Clave de AirLabs" />
            </label>
            <div className="inline-actions">
              <button className="button" type="submit">Guardar y probar</button>
              {clave.source === "panel" ? (
                <button className="ghost-button" type="submit" name="borrar" value="1">Borrar</button>
              ) : null}
            </div>
            <small className="quantity-help">
              Se guarda en la base y se prueba al instante trayendo los vuelos de hoy. La clave no se muestra entera.
            </small>
          </form>
        ) : (
          <p className="muted">Sólo un administrador puede cambiarla.</p>
        )}
      </section>

      <table className="data-table">
        <thead>
          <tr><th>Hora</th><th>Vuelo</th><th>Dirección</th><th>Origen / destino</th><th>Estado</th><th>Reservas / combis</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          {vuelos.map((v) => {
            const snapshot = { status: v.status, scheduledAt: v.scheduledAt, estimatedAt: v.estimatedAt };
            const alerta = needsAttention(snapshot);
            const ocupados = pasajerosOcupados(v.reservations.map((r) => r.reservation));
            const capacidad = capacidadDeVuelo(v.assignments.map((a) => ({ seats: a.vehicle.seats.length })));
            const faltanCombis = ocupados > capacidad;
            return (
              <tr key={v.id}>
                <td>{hhmm(v.scheduledAt)}{v.estimatedAt ? ` → ${hhmm(v.estimatedAt)}` : ""}</td>
                <td>{v.number}{v.airline ? ` · ${v.airline}` : ""}</td>
                <td>{v.direction === "ARRIVAL" ? "Arribo" : "Partida"}</td>
                <td>{v.origin}</td>
                <td>
                  {alerta ? <span className="status-dot">● {statusDetail(snapshot)}</span> : `${statusLabel(v.status)} · ${statusDetail(snapshot)}`}
                  {v.source === "ESTIMADO" ? <span className="muted"> (estimado)</span> : v.source !== "API" ? <span className="muted"> (a mano)</span> : null}
                </td>
                <td>
                  <div>
                    <strong>{ocupados}</strong> reservas · <strong>{capacidad}</strong> lugares
                    {faltanCombis ? <span className="status-dot"> ● falta combi</span> : null}
                  </div>
                  <div className="muted">
                    {v.assignments.length === 0
                      ? "sin combi asignada"
                      : v.assignments.map((a) => `${a.vehicle.name} (${a.vehicle.seats.length})`).join(" · ")}
                    {!faltanCombis && v.assignments.length === 0 && ocupados > 0 ? ` · conviene ${combisSugeridas(ocupados)} combi(s)` : ""}
                  </div>
                  <div className="inline-actions">
                    <form className="inline-actions" action={assignVehicleAction}>
                      <input type="hidden" name="flightId" value={v.id} />
                      <select name="vehicleId" defaultValue="">
                        <option value="">Combi…</option>
                        {naves.map((n) => (
                          <option key={n.id} value={n.id}>{n.name}</option>
                        ))}
                      </select>
                      <button className="ghost-button" type="submit">Asignar</button>
                    </form>
                    {v.assignments.map((a) => (
                      <form key={a.id} action={removeAssignmentAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className="ghost-button" type="submit">Quitar {a.vehicle.name}</button>
                      </form>
                    ))}
                  </div>
                </td>
                <td>
                  <div className="inline-actions">
                    <form className="inline-actions" action={updateFlightAction}>
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
