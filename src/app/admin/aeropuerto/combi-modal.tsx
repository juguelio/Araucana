import type { Prisma } from "@prisma/client";
import { butacasParaAeropuerto, capacidadDeVuelo, pasajerosOcupados } from "@/lib/airport/booking";
import { prisma } from "@/lib/db/prisma";
import { FleetAssignmentForm } from "../fleet-assignment-form";
import { RowModal } from "../reservas/row-modal";
import { assignVehicleAction, removeAssignmentAction } from "./actions";
import { SelectorNaveYChofer, type ChoferOpcion } from "@/components/asignar-flota/selector-nave-chofer";
import { tituloDeNave } from "@/lib/fleet/titulo-de-nave";
import { airportServiceWindow } from "@/lib/airport/service-window";
import { ocupacionEnVentana, type Ocupacion } from "@/lib/fleet/ocupacion";
import type { NaveElegible } from "./nave-buscador";

type ChoferElegible = ChoferOpcion;
import { NAVES_STEP_FIELD, ORDER_RETURN_FIELD } from "./return-to-order";
import "./aeropuerto.css";
import "./combi-modal.css";

/** Lo que necesita el modal de un vuelo: sus combis (con butacas y chofer) y sus pasajeros. */
export const INCLUDE_COMBIS_DEL_VUELO = {
  reservations: { include: { reservation: { select: { passengerCount: true, status: true, shortCode: true } } } },
  assignments: { orderBy: { createdAt: "asc" }, include: { vehicle: { include: { seats: true } }, driver: { select: { id: true, name: true, email: true } } } }
} satisfies Prisma.FlightInclude;

export type VueloConCombis = Prisma.FlightGetPayload<{ include: typeof INCLUDE_COMBIS_DEL_VUELO }>;

type Chofer = { id: string; name: string | null; email: string };

export const nombreDeChofer = (chofer: { name: string | null; email: string }) => chofer.name?.trim() || chofer.email;

const hhmm = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Salta" });

/** Naves (sin utilitarios) y choferes activos para elegir en el modal. */
export async function opcionesDeNave() {
  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true, kind: { not: "UTILITARIO" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, internalNumber: true, licensePlate: true, _count: { select: { seats: true } } }
  });
  return vehicles.map(({ _count, ...vehicle }) => ({ ...vehicle, seats: butacasParaAeropuerto(_count.seats) }));
}

export async function opcionesDeCombi(): Promise<{ naves: NaveElegible[]; choferes: ChoferElegible[] }> {
  const [naves, choferes] = await Promise.all([
    opcionesDeNave(),
    prisma.user.findMany({
      where: { role: "DRIVER", isActive: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true }
    })
  ]);
  return { naves, choferes: choferes.map(chofer => ({ id: chofer.id, label: nombreDeChofer(chofer), email: chofer.email })) };
}

/** «Sprinter 1 (15) · Ramón Paz»: las combis del vuelo con su chofer, como se ven en el botón. */
/**
 * Rótulo corto para la tarjeta: con una combi, la combi y su chofer; con varias (una recorrida con dos
 * trafics), sólo cuántas y cuáles, para que entre en el renglón. El detalle completo va en el `title`.
 */
export function combisCortas(vuelo: VueloConCombis) {
  if (vuelo.assignments.length <= 1) return combisDelVuelo(vuelo);
  // Con tres o más los nombres ya no entran: sólo cuántas (el detalle está en el title y en el modal).
  if (vuelo.assignments.length > 2) return `${vuelo.assignments.length} combis`;
  return `${vuelo.assignments.length} combis: ${vuelo.assignments.map((a) => a.vehicle.name).join(" + ")}`;
}

export function combisDelVuelo(vuelo: VueloConCombis) {
  return vuelo.assignments
    .map((a) => `${a.vehicle.name} (${butacasParaAeropuerto(a.vehicle.seats.length)})${a.privateReservationId ? " · privada" : ""} · ${a.driver ? nombreDeChofer(a.driver) : "sin chofer"}`)
    .join(" · ");
}

/**
 * El modal «Combi del vuelo»: las combis ya asignadas (cambiar chofer o quitar) y el formulario para
 * sumar una nave con su chofer, los dos con buscador. Lo usan la tarjeta del vuelo en Aeropuerto y
 * cada orden de servicio. `volverAOrden` (la query de la orden) hace que, al guardar, se vuelva a la
 * orden en vez de al tablero de aeropuerto.
 */
/**
 * Las combis de toda la recorrida, para verlas y manejarlas desde cualquiera de sus vuelos: la unión de
 * las de cada vuelo (una por nave, la del propio vuelo primero) y los pasajeros de todos. Asignar,
 * cambiar el chofer o quitar ya actúan sobre toda la recorrida (`assignVehicleAction`,
 * `removeAssignmentAction`). Un vuelo sin recorrida queda igual.
 */
export function vueloDeLaRecorrida(vuelo: VueloConCombis, companeros: VueloConCombis[]): VueloConCombis {
  if (!companeros.length) return vuelo;
  const assignments = [...vuelo.assignments];
  for (const asignacion of companeros.flatMap((otro) => otro.assignments)) {
    if (!assignments.some((propia) => propia.vehicleId === asignacion.vehicleId)) assignments.push(asignacion);
  }
  return { ...vuelo, assignments, reservations: [...vuelo.reservations, ...companeros.flatMap((otro) => otro.reservations)] };
}

export function CombiDelVueloModal({ vuelo, naves, choferes, trigger, triggerLabel, triggerClassName, resetKey, volverAOrden, recorrida = [], paso, ocupacion = [] }: {
  vuelo: VueloConCombis;
  naves: NaveElegible[];
  choferes: ChoferElegible[];
  trigger: string;
  triggerLabel: string;
  triggerClassName: string;
  /** Cambia después de guardar (el aviso de la URL) para que el modal se cierre y vuelva limpio. */
  resetKey: string;
  volverAOrden?: string;
  /** Los números de los otros vuelos de la recorrida, para el título. */
  recorrida?: string[];
  /**
   * Paso 2 de coordinar una recorrida: el modal se abre solo y queda abierto mientras se suman, quitan
   * o cambian naves. `listoHref` cierra el paso (vuelve al tablero sin el modal).
   */
  paso?: { listoHref: string };
  /** Lo que ocupa naves y choferes ese día (`cargarOcupacionDelDia`), para marcar quién está libre. */
  ocupacion?: Ocupacion[];
}) {
  const compartidas = vuelo.assignments.filter(a => !a.privateReservationId);
  const privadas = vuelo.reservations.filter(r => r.flightId === vuelo.id && r.isPrivate && r.reservation.status !== "CANCELLED");
  const gruposPrivados = privadas.map(r => ({
    detalle: r, asignacion: vuelo.assignments.find(a => a.privateReservationId === r.reservationId)
  }));
  const ocupados = pasajerosOcupados(vuelo.reservations.filter(r => !r.isPrivate).map(r => r.reservation));
  const capacidad = capacidadDeVuelo(compartidas.map((a) => ({ seats: a.vehicle.seats.length })));
  // Si la combi tiene un chofer que ya no está activo, se sigue mostrando para no borrarlo sin querer.
  const choferesCon = (actual: Chofer | null) =>
    actual && !choferes.some((chofer) => chofer.id === actual.id)
      ? [{ id: actual.id, label: `${nombreDeChofer(actual)} (inactivo)`, email: actual.email }, ...choferes]
      : choferes;
  const volver = volverAOrden
    ? <input type="hidden" name={ORDER_RETURN_FIELD} value={volverAOrden} />
    : paso ? <input type="hidden" name={NAVES_STEP_FIELD} value={vuelo.id} /> : null;
  const vuelos = [vuelo.number, ...recorrida].join(" + ");
  // El tramo del vuelo (recorrida o reparto) y quién está en otro servicio en ese tramo. Los vuelos
  // de la misma recorrida no cuentan como cruce: el chofer y la nave hacen toda la vuelta. Las OTRAS
  // combis de este vuelo sí cuentan — si ya están acá, no están libres (#439).
  const ventana = airportServiceWindow({ ...vuelo, status: vuelo.status ?? undefined });
  const propios = vuelo.assignments
    .filter((asignacion) => asignacion.flightId !== vuelo.id)
    .map((asignacion) => asignacion.privateReservationId
      ? `privada:${asignacion.privateReservationId}`
      : `vuelo:${asignacion.flightId}:${asignacion.vehicleId}`);
  const tramo = { desde: ventana.startsAt, hasta: ventana.endsAt };
  const ocupacionNaves = ocupacionEnVentana(ocupacion, "nave", tramo, propios);
  const ocupacionChoferes = ocupacionEnVentana(ocupacion, "chofer", tramo, propios);
  const faltan = Math.max(0, ocupados - capacidad);

  function estado(a?: VueloConCombis["assignments"][number]) {
    return a ? `${tituloDeNave(a.vehicle)} · ${a.driver ? nombreDeChofer(a.driver) : "sin chofer"}` : "Sin nave asignada";
  }
  const resumenPublico = compartidas.length ? compartidas.map(estado).join(" / ") : estado();
  const selectorPublico = (
    <>
      {compartidas.length ? (
        <div className="aero-combi-asignadas">
          <strong>Ahora</strong>
          {compartidas.map((a) => (
            <div key={a.id} className="aero-combi-asignada">
              <span>
                <strong>{tituloDeNave(a.vehicle)}</strong> · {butacasParaAeropuerto(a.vehicle.seats.length)} lugares · {a.driver ? `chofer ${nombreDeChofer(a.driver)}` : "sin chofer"}
              </span>
              {/* El chofer de una combi ya asignada se cambia acá mismo: avisa si está ocupado en otra salida. */}
              <FleetAssignmentForm action={assignVehicleAction}>
                <input type="hidden" name="flightId" value={vuelo.id} />
                <input type="hidden" name="vehicleId" value={a.vehicle.id} />
                {volver}
                <select name="driverId" defaultValue={a.driver?.id ?? ""} aria-label={`Chofer de ${a.vehicle.name}`}>
                  <option value="">Sin chofer</option>
                  {choferesCon(a.driver).map((chofer) => <option key={chofer.id} value={chofer.id}>{chofer.label}</option>)}
                </select>
                <button className="ghost-button" type="submit">Guardar chofer</button>
              </FleetAssignmentForm>
              <form action={removeAssignmentAction}>
                <input type="hidden" name="id" value={a.id} />
                {volver}
                <button className="ghost-button" type="submit">Quitar</button>
              </form>
            </div>
          ))}
        </div>
      ) : null}
      <FleetAssignmentForm action={assignVehicleAction}>
        <input type="hidden" name="flightId" value={vuelo.id} />
        {volver}
        {/* El mismo selector que Servicio público y Naves en vivo: libre u ocupada a la hora del vuelo. */}
        <SelectorNaveYChofer
          servicio={gruposPrivados.length ? `traslado público del ${vuelos}` : `vuelo ${vuelos}`}
          naves={naves.filter((nave) => !vuelo.assignments.some((a) => a.vehicle.id === nave.id))}
          choferes={choferes}
          ocupacionNaves={ocupacionNaves}
          ocupacionChoferes={ocupacionChoferes}
          lugaresQueFaltan={compartidas.length ? faltan || null : ocupados || null}
          seatsLabel="lugares para aeropuerto"
          boton={compartidas.length ? "Sumar nave" : "Asignar"}
        />
      </FleetAssignmentForm>
    </>
  );

  return (
    <RowModal
      key={`combi-${vuelo.id}-${resetKey}-${vuelo.assignments.map(a => a.id + (a.driverId ?? "")).join("/")}`}
      trigger={gruposPrivados.length ? <>
        <span><strong>Pública</strong> · {resumenPublico}</span>
        {gruposPrivados.map(({ detalle, asignacion }) => <span key={detalle.id}>
          <strong>Privada{gruposPrivados.length > 1 ? ` · ${detalle.reservation.shortCode}` : ""}</strong> · {estado(asignacion)}
        </span>)}
      </> : trigger}
      triggerLabel={gruposPrivados.length ? [
        `Asignar naves y choferes del ${vuelo.number}`, `Pública · ${resumenPublico}`,
        ...gruposPrivados.map(({ detalle, asignacion }) => `Privada ${detalle.reservation.shortCode} · ${estado(asignacion)}`)
      ].join(". ") : triggerLabel}
      triggerClassName={gruposPrivados.length ? `${triggerClassName} aero-flota-mixta` : triggerClassName}
      modalClassName="asignar-flota-modal aero-combi-modal"
      defaultOpen={Boolean(paso)}
      eyebrow={paso ? "Paso 2 de 2 · Naves y choferes" : `${vuelo.direction === "ARRIVAL" ? "Arribo" : "Partida"} ${hhmm.format(vuelo.scheduledAt)}`}
      title={recorrida.length ? `Combis de la recorrida ${vuelos}` : gruposPrivados.length ? `Naves y choferes del ${vuelo.number}` : `Combi del ${vuelo.number}`}
      subtitle={gruposPrivados.length ? undefined : `${ocupados} ${ocupados === 1 ? "pasajero" : "pasajeros"} · ${vuelo.assignments.length ? `${capacidad} lugares en las combis asignadas` : "sin combi asignada"}`}
    >
      {paso ? (
        <p className="muted">
          Las naves que ya tenían los vuelos aparecen abajo: cambiales el chofer o quitá las que sobran, y sumá las que
          falten. Cuando esté, tocá «Listo».
        </p>
      ) : null}
      {vuelo.pickupGroupId && !paso ? (
        <p className="muted">
          Este vuelo va en una recorrida con otros: la nave y el chofer del traslado público se asignan a <strong>todos los vuelos de la
          recorrida</strong>. Si sale con más de una, la orden de servicio reparte a los pasajeros de todos los vuelos
          entre las naves, por zona, para que cada una haga el recorrido más corto. Para manejarlos por separado, usá
          «Separar» en el vuelo.
        </p>
      ) : null}
      {gruposPrivados.map(({ detalle, asignacion }) => {
        const clave = `privada:${detalle.reservationId}`;
        const etiqueta = `Privada · ${detalle.reservation.shortCode}`;
        const disponibles = naves.filter(n => n.id === asignacion?.vehicleId || (
          (n.seats ?? 0) >= detalle.reservation.passengerCount && !vuelo.assignments.some(a => a.vehicleId === n.id)
        ));
        return <details key={detalle.id} className="aero-tipo-traslado">
          <summary><strong>{etiqueta}</strong><span>{estado(asignacion)} · {detalle.reservation.passengerCount} pax</span></summary>
          <FleetAssignmentForm action={assignVehicleAction}>
            <input type="hidden" name="flightId" value={vuelo.id} />
            <input type="hidden" name="privateReservationId" value={detalle.reservationId} />
            <input type="hidden" name="assignmentId" value={asignacion?.id ?? ""} />
            <input type="hidden" name="previousDriverId" value={asignacion?.driverId ?? ""} />
            {volver}
            <SelectorNaveYChofer servicio={etiqueta} naves={disponibles} choferes={choferesCon(asignacion?.driver ?? null)}
              naveActual={asignacion?.vehicleId} choferActual={asignacion?.driverId ?? ""}
              ocupacionNaves={ocupacionEnVentana(ocupacion, "nave", tramo, [clave])}
              ocupacionChoferes={ocupacionEnVentana(ocupacion, "chofer", tramo, [clave])}
              seatsLabel="lugares para aeropuerto" boton="Guardar asignación privada" />
          </FleetAssignmentForm>
          {asignacion && <form action={removeAssignmentAction}>
            <input type="hidden" name="id" value={asignacion.id} />{volver}
            <button className="ghost-button" type="submit">Quitar nave privada</button>
          </form>}
        </details>;
      })}
      {gruposPrivados.length ? <section className="aero-tipo-traslado" aria-label="Traslado público">
        <h3>Traslado público</h3><p>{resumenPublico} · {ocupados} pax</p>
        {selectorPublico}
      </section> : selectorPublico}
      {paso ? (
        <div className="form-actions">
          <a className="button" href={paso.listoHref}>Listo</a>
        </div>
      ) : null}
    </RowModal>
  );
}
