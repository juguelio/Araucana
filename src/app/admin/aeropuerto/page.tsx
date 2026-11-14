import { FleetAssignmentForm } from "../fleet-assignment-form";
import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { AirlineBadge } from "@/components/airline-badge";
import { airlineName } from "@/lib/airport/airlines";
import { capacidadDeVuelo, combisSugeridas, pasajerosOcupados } from "@/lib/airport/booking";
import { separarVuelosDelTablero } from "@/lib/airport/flight-board";
import { changeKindLabel, FLIGHT_STATUSES, needsAttention, statusDetail } from "@/lib/airport/flights";
import { airportPickupDateTime, airportPickupStart } from "@/lib/airport/pickup-start";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";
import { airLabsKeyState } from "@/lib/settings/app-settings";
import { assignVehicleAction, createFlightAction, deleteFlightAction, refreshFlightsAction, removeAssignmentAction, saveAirLabsKeyAction, savePickupStartAction } from "./actions";
import { FlightForm } from "./flight-form";

type PageProps = { searchParams?: Promise<{ notice?: string; date?: string; solo?: string }> };

/** Lo que necesita la tarjeta del vuelo: eventos, pasajeros y combis asignadas. */
const INCLUDE_VUELO = {
  events: { orderBy: { detectedAt: "desc" }, take: 1 },
  reservations: { include: { reservation: { select: { passengerCount: true, status: true } } } },
  assignments: { include: { vehicle: { include: { seats: true } }, driver: { select: { name: true, email: true } } } }
} satisfies Prisma.FlightInclude;

type VueloDelDia = Prisma.FlightGetPayload<{ include: typeof INCLUDE_VUELO }>;

const TZ_OFFSET_MIN = -180; // America/Argentina/Salta (-03), sin horario de verano

function diaLocal(d: Date) {
  return new Date(d.getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

function rangoDelDia(fecha: string) {
  const desde = new Date(`${fecha}T00:00:00.000-03:00`);
  return { desde, hasta: new Date(desde.getTime() + 24 * 3600 * 1000) };
}

const hhmm = (d: Date) => new Date(d.getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(11, 16);

/** De dónde salió el dato, en una palabra. */
function origenDelDato(source: string) {
  if (source === "ESTIMADO") return "estimado";
  if (source === "MANUAL") return "a mano";
  if (source === "FIDS") return "tablero";
  // Lo cargó el pasajero al reservar: nadie lo verificó todavía contra la aerolínea ni el tablero.
  if (source === "PASAJERO") return "cargado por el pasajero · verificar";
  return null;
}

/** Color del estado: lo que hay que mirar, lo que ya pasó, o lo normal. */
function tonoDelEstado(snapshot: { status: string; scheduledAt: Date; estimatedAt: Date | null }) {
  if (["CANCELLED", "DIVERTED"].includes(snapshot.status)) return "grave";
  if (needsAttention(snapshot)) return "atencion";
  if (snapshot.status === "LANDED") return "ok";
  if (snapshot.status === "EN_ROUTE") return "curso";
  return "normal";
}

export default async function AirportPage({ searchParams }: PageProps) {
  const usuario = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const hoy = diaLocal(new Date());
  const fecha = params?.date ?? hoy;
  const soloAlerta = params?.solo === "alerta";
  const { desde, hasta } = rangoDelDia(fecha);
  const ahora = new Date();

  const vuelos = await prisma.flight.findMany({
    where: { scheduledAt: { gte: desde, lt: hasta } },
    orderBy: { scheduledAt: "asc" },
    include: INCLUDE_VUELO
  });

  const naves = await prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });

  const imprevistos = vuelos.filter((v) => needsAttention({ status: v.status, scheduledAt: v.scheduledAt, estimatedAt: v.estimatedAt }));
  const visibles = soloAlerta ? imprevistos : vuelos;
  const conEvento = await prisma.flightEvent.findMany({
    where: { flight: { scheduledAt: { gte: desde, lt: hasta } } },
    orderBy: { detectedAt: "desc" },
    take: 8,
    include: { flight: { select: { number: true } } }
  });

  const clave = await airLabsKeyState();

  // Cómo viene el día, de un vistazo: lo mismo que dice cada tarjeta, sumado.
  const resumen = vuelos.reduce(
    (acc, v) => {
      const ocupados = pasajerosOcupados(v.reservations.map((r) => r.reservation));
      acc.pasajeros += ocupados;
      if (v.direction === "ARRIVAL") acc.arribos += 1;
      else acc.partidas += 1;
      if (ocupados > 0 && v.assignments.length === 0) acc.sinCombi += 1;
      return acc;
    },
    { arribos: 0, partidas: 0, pasajeros: 0, sinCombi: 0 }
  );
  const partidasParaCoordinar = vuelos.filter((vuelo) => airportPickupStart(vuelo));
  const link = (extra: string) => `/admin/aeropuerto?date=${fecha}${extra}`;

  // La tarjeta se usa dos veces: arriba lo que sigue en juego y abajo, plegado y en gris, lo que
  // ya pasó. Es la misma tarjeta —con pasajeros, combi y hoja del chofer— porque el operador
  // todavía tiene que poder abrirla.
  const tarjeta = (v: VueloDelDia, pasado = false) => {
    const snapshot = { status: v.status, scheduledAt: v.scheduledAt, estimatedAt: v.estimatedAt };
    const alerta = needsAttention(snapshot);
    const ocupados = pasajerosOcupados(v.reservations.map((r) => r.reservation));
    const capacidad = capacidadDeVuelo(v.assignments.map((a) => ({ seats: a.vehicle.seats.length })));
    const faltanCombis = ocupados > capacidad;
    const estima = v.estimatedAt && hhmm(v.estimatedAt) !== hhmm(v.scheduledAt) ? hhmm(v.estimatedAt) : null;
    const extra = origenDelDato(v.source);
    const pickupStart = airportPickupStart(v);

    return (
      <article id={`vuelo-${v.id}`} className="flight-card" data-alerta={alerta} data-pasado={pasado ? "true" : undefined} key={v.id}>
        <div className="flight-main">
          <div className="flight-time">
            <strong>{hhmm(v.scheduledAt)}</strong>
            {estima ? <span className="flight-estima">{estima} estima</span> : null}
          </div>
          <div className="flight-id">
            <AirlineBadge code={v.airline} size={30} />
            <span>
              <strong>{v.number}</strong>
              <small className="muted">
                {airlineName(v.airline) ?? "Sin aerolínea"}
                {extra ? ` · ${extra}` : ""}
              </small>
            </span>
          </div>
          <span className="pill pill-estado" data-tono={tonoDelEstado(snapshot)}>
            {statusDetail(snapshot)}
          </span>
          <span className="flight-pax">
            <strong>{ocupados}</strong>
            <span className="muted">/{capacidad} lugares</span>
            {faltanCombis ? <span className="pill pill-alerta">falta combi</span> : null}
          </span>
        </div>

        <div className="flight-foot">
          <span className="muted">{v.origin}</span>
          {pickupStart ? <span className="muted">Recorrida {v.pickupStartOverrideAt ? "coordinada" : "estimada"}: {airportPickupDateTime.format(pickupStart)}</span> : null}
          {v.assignments.length === 0 ? (
            ocupados > 0 ? (
              <span className="pill pill-alerta pill-combi">
                sin combi · conviene {combisSugeridas(ocupados)} {combisSugeridas(ocupados) === 1 ? "combi" : "combis"}
              </span>
            ) : (
              <span className="muted">sin combi asignada</span>
            )
          ) : (
            <span className="pill pill-combi" data-tono="ok">
              {v.assignments.map((a) => `${a.vehicle.name} (${a.vehicle.seats.length})`).join(" · ")}
            </span>
          )}
          <span className="flight-card-actions">
          {ocupados > 0 ? (
            <>
              <Link
                className="ghost-button"
                href={`/admin/aeropuerto/orden-de-servicio/ver?date=${encodeURIComponent(fecha)}&flight=${v.id}`}
                target="_blank"
                rel="noreferrer"
                title="Ver la hoja de este vuelo en pantalla (para imprimir o corregir un dato)"
              >
                Ver hoja
              </Link>
              <a
                className="ghost-button"
                href={`/admin/aeropuerto/orden-de-servicio?date=${encodeURIComponent(fecha)}&flight=${v.id}`}
                title="Hoja de este vuelo para el chofer (Excel)"
              >
                Hoja del chofer
              </a>
            </>
          ) : null}
          <Link className="ghost-button" href={`/admin/aeropuerto/${v.id}/editar`}>Editar vuelo</Link>
          </span>
          <details className="flight-actions">
            <summary>Gestionar vuelo</summary>
            <div className="flight-actions-body">
              <FleetAssignmentForm action={assignVehicleAction}>
                <input type="hidden" name="flightId" value={v.id} />
                <select name="vehicleId" defaultValue="" aria-label={`Combi para ${v.number}`}>
                  <option value="">Combi…</option>
                  {naves.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
                <button className="ghost-button" type="submit">Asignar</button>
              </FleetAssignmentForm>
              {v.assignments.map((a) => (
                <form key={a.id} action={removeAssignmentAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button className="ghost-button" type="submit">Quitar {a.vehicle.name}</button>
                </form>
              ))}
              <form action={deleteFlightAction}>
                <input type="hidden" name="id" value={v.id} />
                <button className="ghost-button" type="submit">Borrar vuelo</button>
              </form>
            </div>
          </details>
        </div>
      </article>
    );
  };

  return (
    <AdminShell
      title="Aeropuerto"
      eyebrow="Operación"
      notice={params?.notice}
      action={
        <div className="form-actions flights-header-actions">
          <Link className="button" href={`/admin/aeropuerto/reservar?date=${encodeURIComponent(fecha)}`}>Nueva reserva</Link>
          <form action={refreshFlightsAction}>
            <button className="ghost-button" type="submit">Actualizar ahora</button>
          </form>
          <span className="flights-action-group" role="group" aria-label="Orden de servicio">
            <Link
              className="ghost-button"
              href={`/admin/aeropuerto/orden-de-servicio/ver?date=${encodeURIComponent(fecha)}`}
              target="_blank"
              rel="noreferrer"
              title="Ver la orden de servicio en pantalla: se puede imprimir y corregir un dato de cada reserva"
            >
              Orden de servicio
            </Link>
            <a
              className="ghost-button"
              href={`/admin/aeropuerto/orden-de-servicio?date=${encodeURIComponent(fecha)}`}
              title="Hoja para el chofer: un bloque por vuelo, con pasajeros, contacto y pago"
            >
              Excel
            </a>
          </span>
          {usuario.role === "ADMIN" ? <Link className="ghost-button" href="/admin/aeropuerto/cobertura">Mapa de cobertura</Link> : null}
        </div>
      }
    >
      <section className="flights-toolbar">
        <form className="flights-date" method="get">
          <label>
            Día
            <input type="date" name="date" defaultValue={fecha} />
          </label>
          <button className="button" type="submit">Ver</button>
          {fecha !== hoy ? <a className="ghost-button" href="/admin/aeropuerto">Hoy</a> : null}
        </form>
        <div className="flights-filters">
          <a href={link("")} data-active={!soloAlerta}>
            Todos <span>{vuelos.length}</span>
          </a>
          <a href={link("&solo=alerta")} data-active={soloAlerta}>
            Con imprevisto <span>{imprevistos.length}</span>
          </a>
        </div>
      </section>

      {vuelos.length > 0 ? (
        <dl className="flights-summary" aria-label="Resumen del día">
          <div><dt>Arribos</dt><dd>{resumen.arribos}</dd></div>
          <div><dt>Partidas</dt><dd>{resumen.partidas}</dd></div>
          <div><dt>Pasajeros</dt><dd>{resumen.pasajeros}</dd></div>
          <div data-alerta={imprevistos.length > 0}><dt>Con imprevisto</dt><dd>{imprevistos.length}</dd></div>
          <div data-alerta={resumen.sinCombi > 0}><dt>Sin combi</dt><dd>{resumen.sinCombi}</dd></div>
        </dl>
      ) : null}

      <p className="muted flights-note">
        {fecha === hoy ? "Hoy" : <strong>{fecha}</strong>} · datos de AirLabs y del tablero del aeropuerto. Se marcan
        los <em>estimados</em> y los cargados <em>a mano</em>; el <strong>borde de color</strong>, los vuelos con
        imprevisto.
      </p>

      {partidasParaCoordinar.length ? (
        <details className="plain-card admin-section">
          <summary><strong>Coordinar inicio de recorrida</strong></summary>
          <p className="muted">Seleccioná una partida o varias si la misma camioneta hace la recorrida. La hora indica cuándo empieza la búsqueda por las direcciones. Verificá que la unidad asignada tenga lugar para todos los pasajeros.</p>
          <form action={savePickupStartAction}>
            <input type="hidden" name="date" value={fecha} />
            <fieldset>
              <legend>Partidas</legend>
              {partidasParaCoordinar.map((vuelo) => (
                <div key={vuelo.id}>
                  <label><input type="checkbox" name="flightId" value={vuelo.id} /> {vuelo.number} · vuelo {hhmm(vuelo.scheduledAt)} · recorrida {airportPickupDateTime.format(airportPickupStart(vuelo)!)} {vuelo.pickupStartOverrideAt ? "(coordinada)" : "(estimada)"}</label>
                </div>
              ))}
            </fieldset>
            <div className="form-actions">
              <label>Inicio de recorrida <input type="datetime-local" name="pickupStart" /></label>
              <button className="button" type="submit" name="operation" value="save">Guardar horario</button>
              <button className="ghost-button" type="submit" name="operation" value="reset">Restaurar estimado</button>
            </div>
          </form>
        </details>
      ) : null}

      {visibles.length === 0 ? (
        <section className="plain-card admin-section">
          <p className="muted">
            {soloAlerta ? "Ningún vuelo con imprevisto ese día." : `No hay vuelos cargados para ${fecha}.`}
          </p>
        </section>
      ) : (
        <div className="flights-board">
        {(["ARRIVAL", "DEPARTURE"] as const).map((dir) => {
          const lista = visibles.filter((v) => v.direction === dir);
          if (lista.length === 0) return null;
          // Lo que sigue en juego arriba (el más cercano primero) y lo que ya pasó abajo, en gris.
          const { enJuego, terminados } = separarVuelosDelTablero(lista, ahora);
          // Un vuelo que ya pasó pero tuvo demora o cancelación no se esconde: el bloque arranca abierto.
          const pasadosConImprevisto = terminados.some((v) =>
            needsAttention({ status: v.status, scheduledAt: v.scheduledAt, estimatedAt: v.estimatedAt })
          );
          return (
            <section className="flights-group" key={dir}>
              <h2 className="flights-group-title">
                {dir === "ARRIVAL" ? "Arribos" : "Partidas"} <span className="muted">{lista.length}</span>
              </h2>
              <div className="flights-list">
                {enJuego.map((v) => tarjeta(v))}
              </div>
              {terminados.length ? (
                <details className="flights-pasados" open={pasadosConImprevisto}>
                  <summary>
                    {terminados.length === 1 ? "1 vuelo que ya pasó" : `${terminados.length} vuelos que ya pasaron`}
                    {pasadosConImprevisto ? " · con imprevisto" : ""}
                  </summary>
                  <div className="flights-list">
                    {terminados.map((v) => tarjeta(v, true))}
                  </div>
                </details>
              ) : null}
            </section>
          );
        })}
        </div>
      )}

      {conEvento.length > 0 ? (
        <section className="plain-card admin-section">
          <h2>Imprevistos registrados</h2>
          <ul className="events-list">
            {conEvento.map((e) => (
              <li key={e.id}>
                <strong>{hhmm(e.detectedAt)}</strong> · {e.flight.number} · {changeKindLabel(e.kind)}
                {e.fromValue || e.toValue ? ` (${e.fromValue ?? "—"} → ${e.toValue ?? "—"})` : ""}
                <span className="muted">{e.notifiedAt ? " · pasajero avisado" : " · falta avisar al pasajero"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="plain-card admin-section">
        <h2>Cargar vuelo a mano</h2>
        <p className="muted">Estados posibles: {FLIGHT_STATUSES.map((s) => s.label).join(" · ")}.</p>
        <FlightForm action={createFlightAction} />
      </section>

      <details className="plain-card admin-section key-box" open={clave.source === "none"}>
        <summary>
          <span>
            <strong>Clave de AirLabs</strong>
            <small className="muted">
              {clave.source === "none"
                ? "sin configurar — los vuelos no se pueden actualizar"
                : `configurada (${clave.masked})${clave.source === "env" ? " · variables del servidor" : " · desde este panel"}`}
            </small>
          </span>
          <span className="key-box-open muted">{clave.source === "none" ? "Configurar" : "Cambiar"}</span>
        </summary>
        <p className="muted">
          Los horarios y los estados de los vuelos los publica AirLabs; el tablero del aeropuerto cubre las aerolíneas
          que AirLabs no publica. Los vuelos se refrescan con &quot;Actualizar ahora&quot;.
        </p>
        <p>
          Estado:{" "}
          <strong>{clave.source === "none" ? "sin configurar" : `configurada (${clave.masked})`}</strong>
          {clave.source === "env"
            ? " — se toma de las variables del servidor"
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
      </details>
    </AdminShell>
  );
}
