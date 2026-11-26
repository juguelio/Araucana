import { cargarOcupacionDelDia } from "@/lib/fleet/cargar-ocupacion";
import { esHorarioPublicado, flightEvidenceWarning, flightSourceLabel, reliableEstimate } from "@/lib/airport/data-quality";
import { aeropuertoLabel, extremoDelVuelo } from "@/lib/airport/airports";
import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { DriverSheetLabel } from "@/components/driver-sheet-label";
import { AirlineBadge } from "@/components/airline-badge";
import { airlineName } from "@/lib/airport/airlines";
import { capacidadDeVuelo, combisSugeridas, pasajerosOcupados } from "@/lib/airport/booking";
import { separarVuelosDelTablero, vuelosParaElTablero } from "@/lib/airport/flight-board";
import { reservasFantasmaDelDia, reservasFantasmaPorVuelo } from "@/lib/airport/fantasma";
import { changeKindLabel, FLIGHT_STATUSES, needsAttention, statusDetail } from "@/lib/airport/flights";
import { airportPickupDateTime, airportPickupStart } from "@/lib/airport/pickup-start";
import { localInput } from "@/lib/special-trips/data";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";
import { asegurarVuelosRealesDelDia } from "@/lib/airport/freshness";
import { assignVehicleAction, createFlightAction, saveArrivalGroupAction, savePickupStartAction } from "./actions";
import { FlightForm } from "./flight-form";
import { shiftDateKey } from "@/lib/operations/day-board";
import { fechaDeLaOrden } from "@/lib/airport/service-order";
import { HojaDelChoferModal, type OrdenParaLaHoja } from "./hoja-del-chofer-modal";
import { getAirportServiceOrder } from "@/lib/airport/service-order-data";
import { lugaresDeLaOrden, naveDeLaOrden, referenciaDeLaOrden } from "@/lib/airport/service-order";
import { jornadasPorCombi } from "@/lib/airport/driver-day";
import { hojaDeOrdenesHref } from "@/lib/airport/flight-selection";
import { FleetAssignmentForm } from "../fleet-assignment-form";
import { CombiDelVueloModal, combisCortas, combisDelVuelo, INCLUDE_COMBIS_DEL_VUELO, opcionesDeCombi, vueloDeLaRecorrida } from "./combi-modal";
import { RowModal } from "../reservas/row-modal";
import { VUELOS_QUE_NO_SE_OFRECEN } from "@/lib/airport/offered-flights";
import "./aeropuerto.css";
import { isAdminRole } from "@/lib/auth/roles";

type PageProps = { searchParams?: Promise<{ notice?: string; date?: string; solo?: string; naves?: string }> };

/** Lo que necesita la tarjeta del vuelo: eventos, pasajeros y combis asignadas. */
const INCLUDE_VUELO = {
  events: { orderBy: { detectedAt: "desc" }, take: 1 },
  ...INCLUDE_COMBIS_DEL_VUELO,
  reservations: {
    include: {
      reservation: {
        select: {
          passengerCount: true,
          status: true,
          code: true,
          shortCode: true,
          passenger: { select: { firstName: true, lastName: true } }
        }
      }
    }
  }
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

  // Los vuelos de hoy se refrescan solos al abrir la pantalla, con los mismos topes que la web pública
  // (cada 30 minutos como mínimo y 12 veces por día, ver `freshness`). Reemplaza al botón «Actualizar
  // ahora». Nunca rompe: si AirLabs falla, se muestra lo que hay en la base.
  await asegurarVuelosRealesDelDia(fecha, ahora);

  const vuelos = await prisma.flight.findMany({
    where: {
      scheduledAt: { gte: desde, lt: hasta },
      // Neuquén está fuera de la oferta por pedido del cliente (14-nov): no se opera ni se muestra.
      source: { not: "RETIRADO" },
      number: { notIn: [...VUELOS_QUE_NO_SE_OFRECEN] }
    },
    orderBy: { scheduledAt: "asc" },
    include: INCLUDE_VUELO
  });

  // Naves y choferes para el modal de la combi (los mismos que en la orden de servicio).
  const [{ naves, choferes }, ocupacion] = await Promise.all([
    opcionesDeCombi(),
    // Qué naves y choferes están en otro servicio ese día, para marcarlos en el modal de la combi.
    cargarOcupacionDelDia(fecha)
  ]);

  // En un día con vuelos confirmados, una proyeccion es un vuelo fantasma: no entra al tablero y, si
  // tiene reservas encima, se avisa abajo como reserva a reasignar. En un día sin ningún vuelo
  // confirmado se conservan como referencia histórica para Operaciones.
  const { tablero: vuelosDelTablero, fantasma } = vuelosParaElTablero(vuelos);
  const imprevistos = vuelosDelTablero.filter((v) => flightEvidenceWarning(v, ahora) || needsAttention({ status: v.status, scheduledAt: v.scheduledAt, estimatedAt: reliableEstimate(v) }));
  const visibles = soloAlerta ? imprevistos : vuelosDelTablero;
  const conEvento = await prisma.flightEvent.findMany({
    where: { flight: { scheduledAt: { gte: desde, lt: hasta } } },
    orderBy: { detectedAt: "desc" },
    take: 8,
    include: { flight: { select: { number: true } } }
  });

  // Cómo viene el día, de un vistazo: lo mismo que dice cada tarjeta, sumado.
  const resumen = vuelosDelTablero.reduce(
    (acc, v) => {
      const ocupados = pasajerosOcupados(v.reservations.map((r) => r.reservation));
      acc.pasajeros += ocupados;
      if (v.direction === "ARRIVAL") acc.arribos += 1;
      else acc.partidas += 1;
      const pendientes = v.reservations.some(r => r.reservation.status !== "CANCELLED" && (r.isPrivate
        ? !v.assignments.some(a => a.privateReservationId === r.reservationId)
        : !v.assignments.some(a => !a.privateReservationId)));
      if (pendientes) acc.sinCombi += 1;
      return acc;
    },
    { arribos: 0, partidas: 0, pasajeros: 0, sinCombi: 0 }
  );
  const partidasParaCoordinar = vuelosDelTablero.filter((vuelo) => airportPickupStart(vuelo));
  const arribosParaJuntar = vuelosDelTablero.filter((vuelo) => vuelo.direction === "ARRIVAL" && !["CANCELLED", "DIVERTED"].includes(vuelo.status));
  // Con qué otros vuelos del día comparte la camioneta (partidas coordinadas juntas o arribos juntados).
  const mismaVuelta = (a: { id: string; pickupGroupId: string | null }, b: { id: string; pickupGroupId: string | null }) =>
    a.id !== b.id && Boolean(a.pickupGroupId) && a.pickupGroupId === b.pickupGroupId;
  const companeros = (v: { id: string; pickupGroupId: string | null }) => vuelosDelTablero.filter((otro) => mismaVuelta(otro, v));
  // Las órdenes del día tal como las imprime la hoja del chofer: una por vuelo, o una por combi en las
  // recorridas que salen con varias (con gente de todos sus vuelos). Es lo que lista «Hoja del chofer».
  const { blocks: bloquesDelDia } = await getAirportServiceOrder(fecha);
  const jornadas = jornadasPorCombi(bloquesDelDia);
  const arribosParaElIn = vuelosDelTablero.filter((vuelo) => vuelo.direction === "ARRIVAL" && !["CANCELLED", "DIVERTED"].includes(vuelo.status));
  const ordenesParaLaHoja: OrdenParaLaHoja[] = bloquesDelDia
    .filter((block) => block.flightId && block.passengers.length)
    .map((block) => ({
      flight: block.flightId!,
      vehicle: referenciaDeLaOrden(block).vehicle,
      flightIds: block.flightIds,
      vuelos: block.flightNumber,
      // En las partidas, `operationAt` es cuándo empieza la recorrida; en los arribos, cuándo llega el vuelo.
      hora: `${block.direction === "ARRIVAL" ? "llega" : "recorrida"} ${hhmm(block.operationAt)}`,
      combi: naveDeLaOrden(block),
      pasajeros: lugaresDeLaOrden(block)
    }));
  // Reservas que quedaron sobre un vuelo que nadie confirma: no se muestran como vuelo, pero
  // tampoco se esconden, porque son personas que hay que pasar a un vuelo real.
  const reservasFantasma = fantasma.reduce((n, v) => n + v.reservations.length, 0);
  const pasajerosFantasma = fantasma.reduce(
    (n, v) => n + pasajerosOcupados(v.reservations.map((r) => r.reservation)),
    0
  );
  // La lista, no sólo el conteo (#331): cuáles son, con su código y su pasajero, para poder
  // reasignarlas sin abrirlas una por una. Consulta propia sobre los ids fantasma, porque
  // INCLUDE_COMBIS_DEL_VUELO lo comparte la orden de servicio y sólo trae passengerCount y status.
  const idsFantasma = fantasma.flatMap((v) => v.reservations.map((r) => r.reservationId));
  const detalleFantasma = idsFantasma.length ? await prisma.reservation.findMany({
    // Sin filtrar canceladas: el número del aviso las cuenta y la lista tiene que mostrar lo mismo.
    where: { id: { in: idsFantasma } },
    select: { id: true, code: true, shortCode: true, status: true, passengerCount: true,
      passenger: { select: { firstName: true, lastName: true } } }
  }) : [];
  const filasFantasma = reservasFantasmaPorVuelo(reservasFantasmaDelDia(
    fantasma.map((v) => ({ id: v.id, number: v.number, direction: v.direction, hora: hhmm(v.scheduledAt),
      reservas: v.reservations.map((r) => r.reservationId) })),
    detalleFantasma.map((r) => ({ id: r.id, code: r.code, shortCode: r.shortCode, status: r.status,
      passengerCount: r.passengerCount, pasajero: `${r.passenger.firstName} ${r.passenger.lastName}`.trim() }))
  ));
  const link = (extra: string, dia: string = fecha) =>
    `/admin/aeropuerto?date=${dia}${extra || (dia !== fecha && soloAlerta ? "&solo=alerta" : "")}`;

  // La tarjeta se usa dos veces: arriba lo que sigue en juego y abajo, plegado y en gris, lo que
  // ya pasó. Es la misma tarjeta —con pasajeros, combi y hoja del chofer— porque el operador
  // todavía tiene que poder abrirla.
  const tarjeta = (v: VueloDelDia, pasado = false) => {
    const snapshot = { status: v.status, scheduledAt: v.scheduledAt, estimatedAt: reliableEstimate(v) };
    const evidenceWarning = flightEvidenceWarning(v, ahora);
    const alerta = Boolean(evidenceWarning) || needsAttention(snapshot);
    const ocupados = pasajerosOcupados(v.reservations.map((r) => r.reservation));
    const privadas = v.reservations.filter(r => r.isPrivate && r.reservation.status !== "CANCELLED");
    const comunes = ocupados - privadas.reduce((total, r) => total + r.reservation.passengerCount, 0);
    const capacidad = capacidadDeVuelo(v.assignments.filter(a => !a.privateReservationId).map((a) => ({ seats: a.vehicle.seats.length })));
    const faltanCombis = comunes > capacidad;
    const estima = snapshot.estimatedAt && hhmm(snapshot.estimatedAt) !== hhmm(v.scheduledAt) ? hhmm(snapshot.estimatedAt) : null;
    const extra = flightSourceLabel(v.source);
    const ciudad = aeropuertoLabel(extremoDelVuelo(v)) ?? "—";
    // Sin confirmación de la fuente: el vuelo ya pasó su hora y nadie dijo que aterrizó o salió.
    // En el pie tiene que verse —si no parece que aterrizó y nadie lo chequeó— y mientras siga así
    // el operador puede confirmarlo él.
    const confirmado = v.status === "LANDED" || (v.direction === "DEPARTURE" && v.status === "EN_ROUTE");
    const sinConfirmar = pasado && !confirmado;
    const pickupStart = evidenceWarning && !v.pickupStartOverrideAt ? null : airportPickupStart(v);
    // Las combis de toda la recorrida: la tarjeta y su modal muestran las mismas desde cualquier vuelo.
    const recorridaDelVuelo = vueloDeLaRecorrida(v, companeros(v));

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
              <small className="muted flight-airline">
                {airlineName(v.airline) ?? "Sin aerolínea"}
                {extra ? ` · ${extra}` : ""}
              </small>
            </span>
          </div>
          <span className="pill pill-estado" data-tono={tonoDelEstado(snapshot)}>
            {v.source === "REVISAR" ? "Revisar" : sinConfirmar ? "Pasó · sin confirmar" : evidenceWarning ? "A verificar" : v.source === "ESTIMADO" ? "Sin confirmar" : esHorarioPublicado(v.source) && v.status === "SCHEDULED" ? "Programado" : v.source === "MANUAL" && v.status === "SCHEDULED" ? "Sin estado en vivo" : statusDetail(snapshot)}
          </span>
          <span className="flight-pax">
            <strong>{comunes}</strong>
            <span className="muted">/{capacidad} lugares{privadas.length ? " compartidos" : ""}</span>
          </span>
        </div>

        {privadas.map(r => (
          <Link key={r.id} className="table-link" href={`/admin/reservas/${r.reservation.code}`}>
            Privada · {r.reservation.passenger.lastName} · {r.reservation.passengerCount} pax
          </Link>
        ))}
        {evidenceWarning ? <p className="error" role="status">{evidenceWarning}</p> : null}
        {/* Antes, según qué botones tenía el vuelo, «Gestionar vuelo» quedaba en un renglón aparte y
            las tarjetas de una misma columna salían de distinto alto. Ahora todas tienen la misma forma:
            un renglón de datos (combi, recorrida, origen) y uno de acciones del mismo tamaño. */}
        <div className="flight-foot">
          <div className="flight-info">
          {faltanCombis && v.assignments.length > 0 ? <span className="pill pill-alerta pill-combi">falta combi</span> : null}
          {/* La combi del vuelo se asigna desde su propio botón: «sin combi» (o las combis que ya tiene)
              abre un modal con el buscador de naves, en vez del menú «Gestionar vuelo». */}
          <CombiDelVueloModal
            vuelo={recorridaDelVuelo}
            naves={naves}
            choferes={choferes}
            resetKey={params?.notice ?? ""}
            ocupacion={ocupacion}
            recorrida={companeros(v).map((otro) => otro.number)}
            paso={!pasado && params?.naves === v.id ? { listoHref: `/admin/aeropuerto?date=${fecha}` } : undefined}
            trigger={
              recorridaDelVuelo.assignments.length === 0
                ? ocupados > 0
                  ? `sin combi · conviene ${combisSugeridas(ocupados)} ${combisSugeridas(ocupados) === 1 ? "combi" : "combis"}`
                  : "sin combi asignada"
                : combisCortas(recorridaDelVuelo)
            }
            triggerLabel={recorridaDelVuelo.assignments.length === 0 ? `Asignar combi al ${v.number}` : `Cambiar combi del ${v.number}: ${combisDelVuelo(recorridaDelVuelo)}`}
            triggerClassName={`pill pill-combi aero-combi-boton${recorridaDelVuelo.assignments.length ? " aero-combi-ok" : ocupados > 0 ? " pill-alerta" : " aero-combi-vacia"}`}
          />
          {companeros(v).length ? (
            // En una recorrida, un solo dato: con qué vuelos va y, en las partidas, a qué hora arranca.
            <span
              className="pill aero-misma-vuelta"
              title={`Recorrida ${pickupStart ? `${v.pickupStartOverrideAt ? "coordinada" : "estimada"} ${airportPickupDateTime.format(pickupStart)} ` : ""}con ${companeros(v).map((otro) => otro.number).join(", ")}: la orden de servicio junta a sus pasajeros y, si sale con varias combis, los reparte por zona`}
            >
              Recorrida {pickupStart ? `${hhmm(pickupStart)} ` : ""}con {companeros(v).map((otro) => otro.number).join(", ")}
            </span>
          ) : pickupStart ? (
            <span className="muted flight-info-recorrida" title={`Recorrida ${v.pickupStartOverrideAt ? "coordinada" : "estimada"}: ${airportPickupDateTime.format(pickupStart)}`}>
              Recorrida {v.pickupStartOverrideAt ? "coordinada" : "estimada"}: {airportPickupDateTime.format(pickupStart)}
            </span>
          ) : null}
          <span className="muted flight-info-origen" title={ciudad}>{ciudad}</span>
          </div>
          <div className="flight-card-actions">
          {ocupados > 0 ? (
            // «Hoja del chofer» abre un modal para elegir qué vuelos del día imprimir juntos, con este (y
            // los de su recorrida) ya marcados.
            <HojaDelChoferModal date={fecha} flightId={v.id} flightNumber={v.number} ordenes={ordenesParaLaHoja} />
          ) : null}
          {pickupStart && v.direction === "DEPARTURE" ? (
            // Coordinar la recorrida desde el vuelo: el modal trae este vuelo marcado y deja sumar otras
            // partidas del día que hace la misma camioneta, con la hora a la que se empieza a buscar.
            <RowModal
              key={`coordinar-${v.id}-${params?.notice ?? ""}`}
              trigger="Coordinar recorrida"
              triggerLabel={`Coordinar recorrida del ${v.number}`}
              triggerClassName="ghost-button"
              modalClassName="aero-coordinar-modal"
              eyebrow="Paso 1 de 2 · Vuelos y horario"
              title={`Coordinar recorrida · ${v.number}`}
              subtitle="Marcá las partidas que comparten la recorrida y elegí la hora de inicio. Esa hora solo cambia si la editás desde acá. Después elegís las naves y los choferes: si sale con más de una, la hoja del chofer reparte a los pasajeros por zona."
            >
              <form action={savePickupStartAction} className="reservas-modal-form aero-coordinar-form">
                <input type="hidden" name="date" value={fecha} />
                <input type="hidden" name="origen" value={v.id} />
                <fieldset>
                  <legend>Partidas de la misma recorrida</legend>
                  {partidasParaCoordinar.map((vuelo) => (
                    <label key={vuelo.id} className="aero-coordinar-vuelo">
                      <input type="checkbox" name="flightId" value={vuelo.id} defaultChecked={vuelo.id === v.id || mismaVuelta(vuelo, v)} />
                      <span>
                        <strong>{vuelo.number}</strong> · vuelo {hhmm(vuelo.scheduledAt)} · recorrida{" "}
                        {airportPickupDateTime.format(airportPickupStart(vuelo)!)} {vuelo.pickupStartOverrideAt ? "(coordinada)" : "(estimada)"}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <label>
                  Hora en que los busca
                  <input type="datetime-local" name="pickupStart" defaultValue={localInput(pickupStart)} />
                </label>
                <div className="form-actions">
                  <button className="button" type="submit" name="operation" value="save">Siguiente: naves y choferes</button>
                  <button className="ghost-button" type="submit" name="operation" value="reset">Restaurar horario inicial</button>
                </div>
              </form>
            </RowModal>
          ) : null}
          {v.direction === "ARRIVAL" && arribosParaJuntar.length > 1 && arribosParaJuntar.some((vuelo) => vuelo.id === v.id) ? (
            // Los arribos no tienen recorrida coordinada: sólo se marcan los que espera la misma
            // camioneta, para que la hoja del chofer los una en una sola orden.
            <RowModal
              key={`juntar-${v.id}-${params?.notice ?? ""}`}
              trigger="Juntar arribos"
              triggerLabel={`Juntar arribos con el ${v.number}`}
              triggerClassName="ghost-button"
              modalClassName="aero-coordinar-modal"
              eyebrow="Paso 1 de 2 · Vuelos"
              title={`Juntar arribos · ${v.number}`}
              subtitle="Marcá los arribos que se reparten en la misma recorrida. Después elegís las naves y los choferes: si sale con más de una, la hoja del chofer reparte a los pasajeros por zona."
            >
              <form action={saveArrivalGroupAction} className="reservas-modal-form aero-coordinar-form">
                <input type="hidden" name="date" value={fecha} />
                <input type="hidden" name="origen" value={v.id} />
                <fieldset>
                  <legend>Arribos de la misma vuelta</legend>
                  {arribosParaJuntar.map((vuelo) => (
                    <label key={vuelo.id} className="aero-coordinar-vuelo">
                      <input type="checkbox" name="flightId" value={vuelo.id} defaultChecked={vuelo.id === v.id || mismaVuelta(vuelo, v)} />
                      <span>
                        <strong>{vuelo.number}</strong> · llega {hhmm(vuelo.estimatedAt ?? vuelo.scheduledAt)}
                        {vuelo.estimatedAt && hhmm(vuelo.estimatedAt) !== hhmm(vuelo.scheduledAt) ? ` (programado ${hhmm(vuelo.scheduledAt)})` : ""}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="form-actions">
                  <button className="button" type="submit" name="operation" value="join">Siguiente: naves y choferes</button>
                  {v.pickupGroupId ? <button className="ghost-button" type="submit" name="operation" value="split">Separar</button> : null}
                </div>
              </form>
            </RowModal>
          ) : null}
          <Link className="ghost-button" href={`/admin/aeropuerto/${v.id}/editar`}>Editar vuelo</Link>
          </div>
        </div>
      </article>
    );
  };

  return (
    <AdminShell
      title="Aeropuerto"
      eyebrow="Operación"
      role={usuario.role}
      notice={params?.notice}
      action={
        <div className="form-actions flights-header-actions">
          {isAdminRole(usuario.role) ? <Link className="ghost-button" href="/admin/aeropuerto/cobertura">Mapa de cobertura</Link> : null}
          <Link
            className="ghost-button"
            href={`/admin/aeropuerto/orden-de-servicio/ver?date=${encodeURIComponent(fecha)}`}
            target="_blank"
            rel="noreferrer"
            title="Hoja del día: un bloque por vuelo, con pasajeros, contacto y pago. Se imprime o se descarga en Excel desde ahí"
          >
            Hoja del día
          </Link>
          <Link className="button" href={`/admin/reservas/nueva?servicio=aeropuerto&date=${encodeURIComponent(fecha)}`}>Nueva reserva</Link>
          {/* El formulario de carga manual vive en un modal: se usa poco y ocupaba media pantalla. La `key`
              con el aviso lo cierra solo cuando el vuelo se cargó (la acción redirige con `notice`). */}
          <RowModal
            key={params?.notice ?? "sin-aviso"}
            trigger="Cargar vuelo a mano"
            triggerLabel="Cargar vuelo a mano"
            triggerClassName="ghost-button"
            modalClassName="aero-carga-modal"
            eyebrow="Aeropuerto"
            title="Cargar vuelo a mano"
            subtitle={`Para un vuelo que no trae AirLabs ni el tablero. Estados posibles: ${FLIGHT_STATUSES.map((s) => s.label).join(" · ")}.`}
          >
            <div className="aero-carga">
              <FlightForm action={createFlightAction} />
            </div>
          </RowModal>
        </div>
      }
    >
      <section className="flights-toolbar">
        {/* Siempre las dos flechas, para ir de un día al otro sin volver a «hoy». */}
        <form className="flights-date" method="get">
          <Link className="ghost-button flights-dia-paso" href={link("", shiftDateKey(fecha, -1))} aria-label="Día anterior">
            ‹ Anterior
          </Link>
          <label>
            Día
            <input type="date" name="date" defaultValue={fecha} />
          </label>
          {soloAlerta ? <input type="hidden" name="solo" value="alerta" /> : null}
          <button className="button" type="submit">Ver</button>
          <Link className="ghost-button flights-dia-paso" href={link("", shiftDateKey(fecha, 1))} aria-label="Día siguiente">
            Siguiente ›
          </Link>
        </form>
        <div className="flights-filters">
          <a href={link("")} data-active={!soloAlerta}>
            Todos <span>{vuelosDelTablero.length}</span>
          </a>
          <a href={link("&solo=alerta")} data-active={soloAlerta}>
            Con imprevisto <span>{imprevistos.length}</span>
          </a>
        </div>
      </section>

      {vuelosDelTablero.length > 0 ? (
        <dl className="flights-summary" aria-label="Resumen del día">
          <div><dt>Arribos</dt><dd>{resumen.arribos}</dd></div>
          <div><dt>Partidas</dt><dd>{resumen.partidas}</dd></div>
          <div><dt>Pasajeros</dt><dd>{resumen.pasajeros}</dd></div>
          <div data-alerta={imprevistos.length > 0}><dt>Con imprevisto</dt><dd>{imprevistos.length}</dd></div>
          <div data-alerta={resumen.sinCombi > 0}><dt>Sin combi</dt><dd>{resumen.sinCombi}</dd></div>
        </dl>
      ) : null}

      <p className="muted flights-note">
        <strong>{fechaDeLaOrden(fecha)}</strong> · datos de AirLabs y del tablero del aeropuerto. Se marcan
        los <em>estimados</em> y los cargados <em>a mano</em>; el <strong>borde de color</strong>, los vuelos con
        imprevisto.
      </p>



      {visibles.length === 0 ? (
        <section className="plain-card admin-section">
          <p className="muted">
            {soloAlerta ? "Ningún vuelo con imprevisto ese día." : `No hay vuelos cargados para ${fecha}.`}
          </p>
        </section>
      ) : (
        <>
        <div className="flights-board aero-tablero">
        {(["ARRIVAL", "DEPARTURE"] as const).map((dir) => {
          const lista = visibles.filter((v) => v.direction === dir);
          if (lista.length === 0) return null;
          // `visibles` ya trae sólo lo que va al tablero: los confirmados, o las proyecciones de un día
          // que no tiene ninguno. Lo que sigue en juego arriba (el más cercano primero) y lo que ya
          // pasó abajo, en gris; las proyecciones, por horario, después de lo que está en juego.
          const { enJuego, terminados, porVerificar, proyectados } = separarVuelosDelTablero(lista, ahora);
          // Un vuelo que ya pasó pero tuvo demora o cancelación no se esconde: el bloque arranca abierto.
          const terminadosSinConfirmar = terminados.filter(
            (v) => v.status !== "LANDED" && !(v.direction === "DEPARTURE" && v.status === "EN_ROUTE")
          ).length;
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
                {proyectados.map((v) => tarjeta(v))}
              </div>
              {porVerificar.length ? (
                <section className="plain-card admin-section">
                  <h3>Por verificar · {porVerificar.length}</h3>
                  <p className="muted">Fecha o estado inconsistente, o pasó el horario sin confirmación de finalización. Actualizá y contrastá con la fuente.</p>
                  <div className="flights-list">{porVerificar.map((v) => tarjeta(v))}</div>
                </section>
              ) : null}
              {terminados.length ? (
                <details className="flights-pasados" open={pasadosConImprevisto}>
                  <summary>
                    {terminados.length} {terminados.length === 1 ? "vuelo pasado" : "vuelos pasados"}
                    {terminadosSinConfirmar ? ` · ${terminadosSinConfirmar} sin confirmar` : ""}
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
        </>
      )}

      {jornadas.length ? (
        // El día de cada combi: sus OUT (recorridas de partidas) y sus IN (arribos), en orden. El IN se
        // empareja asignándole la misma combi al arribo; la hoja IN/OUT imprime las órdenes juntas.
        <section className="plain-card admin-section aero-por-chofer" id="por-chofer">
          <h2>Por chofer</h2>
          <p className="muted">
            Cada combi con lo que hace en el día: sus OUT (partidas) y sus IN (arribos). Para sumarle el IN que hace
            después de dejar a la gente en el aeropuerto, elegí el arribo: se le asigna la misma combi con el mismo chofer.
          </p>
          <ul className="aero-jornadas">
            {jornadas.map((jornada) => {
              const propios = new Set(jornada.tramos.flatMap((tramo) => tramo.flightIds));
              const arribos = arribosParaElIn.filter((vuelo) => !propios.has(vuelo.id));
              return (
                <li key={jornada.vehicleId} className="aero-jornada">
                  <div className="aero-jornada-combi">
                    <strong>{jornada.nave}</strong>
                    <span className="muted">{jornada.choferes.length ? jornada.choferes.join(" / ") : "sin chofer"}</span>
                  </div>
                  <ol className="aero-jornada-tramos">
                    {jornada.tramos.map((tramo) => (
                      <li key={`${tramo.orden.flight}~${tramo.orden.vehicle ?? ""}`} data-sentido={tramo.direction === "DEPARTURE" ? "out" : "in"}>
                        <strong>{tramo.direction === "DEPARTURE" ? "OUT" : "IN"} {hhmm(tramo.hora)}</strong> · {tramo.vuelos} ·{" "}
                        {tramo.pasajeros} {tramo.pasajeros === 1 ? "pasajero" : "pasajeros"}
                      </li>
                    ))}
                    {jornada.sinIn ? <li className="aero-jornada-falta">sin IN después</li> : null}
                  </ol>
                  <div className="aero-jornada-acciones">
                    <a className="button" href={hojaDeOrdenesHref(fecha, jornada.tramos.map((tramo) => tramo.orden))} target="_blank" rel="noreferrer">
                      <DriverSheetLabel>{new Set(jornada.tramos.map((tramo) => tramo.direction)).size > 1 ? "Hoja IN/OUT" : "Hoja del chofer"}</DriverSheetLabel>
                    </a>
                    {arribos.length ? (
                      <FleetAssignmentForm action={assignVehicleAction}>
                        <input type="hidden" name="vehicleId" value={jornada.vehicleId} />
                        {jornada.choferId ? <input type="hidden" name="driverId" value={jornada.choferId} /> : null}
                        <select name="flightId" aria-label={`IN para ${jornada.nave}`} defaultValue="">
                          <option value="" disabled>Sumar IN…</option>
                          {arribos.map((vuelo) => (
                            <option key={vuelo.id} value={vuelo.id}>{vuelo.number} · llega {hhmm(reliableEstimate(vuelo) ?? vuelo.scheduledAt)}</option>
                          ))}
                        </select>
                        <button className="ghost-button" type="submit">Asignar IN</button>
                      </FleetAssignmentForm>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {reservasFantasma > 0 ? (
        <div className="flights-aviso">
          <p>
            <strong>{reservasFantasma}</strong> {reservasFantasma === 1 ? "reserva" : "reservas"} ({pasajerosFantasma}{" "}
            {pasajerosFantasma === 1 ? "pasajero" : "pasajeros"}) sobre {reservasFantasma === 1 ? "un vuelo" : "vuelos"} que
            ninguna fuente confirma. No se {reservasFantasma === 1 ? "muestra" : "muestran"} en el tablero: reasigná{" "}
            {reservasFantasma === 1 ? "esa reserva" : "esas reservas"} a un vuelo real desde{" "}
            <Link href="/admin/reservas">Reservas</Link>.
          </p>
          <ul className="flights-aviso-lista">
            {filasFantasma.map((grupo) => (
              <li key={`${grupo.vuelo}-${grupo.hora}-${grupo.filas[0]?.flightId}`}>
                <p className="flights-aviso-vuelo">
                  <strong>{grupo.vuelo}</strong> · {grupo.sentido === "ARRIVAL" ? "llegada" : "salida"}{" "}
                  {grupo.hora} · sin verificar
                  {grupo.filas.length === 1 ? "" : ` · ${grupo.filas.length} reservas`}
                </p>
                <ul>
                  {grupo.filas.map((fila) => (
                    <li key={fila.reservaId}>
                      <Link href={`/admin/reservas/${fila.code}/editar`}>{fila.shortCode}</Link>
                      {" · "}{fila.pasajero}
                      {" · "}{fila.passengerCount === 1 ? "1 pasajero" : `${fila.passengerCount} pasajeros`}
                      {" · "}<span className="muted">{fila.estado}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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

    </AdminShell>
  );
}
