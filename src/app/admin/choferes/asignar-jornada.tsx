"use client";

import { startTransition, useActionState, useMemo, useState } from "react";
import { FleetConflictWarning } from "@/app/admin/fleet-assignment-form";
import { RowModal } from "@/app/admin/reservas/row-modal";
import { ETIQUETA_AREA, type AreaDeServicio } from "@/lib/driver/tablero-choferes";
import { asignarChoferANaveAction, type AsignarChoferState } from "./actions";

/** Un servicio del día, listo para el navegador (sin `Date`). */
export type ServicioVista = {
  clave: string;
  area: AreaDeServicio;
  vehicleId: string;
  driverId: string | null;
  desde: number;
  hasta: number;
  horario: string;
  titulo: string;
  asignable: boolean;
};

export type NaveVista = { id: string; titulo: string; detalle: string };
export type ChoferVista = { id: string; nombre: string; iniciales: string };

const sinTildes = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Igual que `preseleccion` (lib/driver/tablero-choferes): lo que no tiene chofer o ya es suyo. */
const vieneTildado = (servicio: ServicioVista, driverId: string) => servicio.asignable && (!servicio.driverId || servicio.driverId === driverId);

/** Completa el chofer de servicios que ya tienen nave. */
export function AsignarJornada({
  dia, diaTexto, servicios, tituloNave, choferes, vehicleId, trigger, triggerClassName
}: {
  dia: string; diaTexto: string; servicios: ServicioVista[]; tituloNave: string;
  choferes: ChoferVista[]; vehicleId: string; trigger: string; triggerClassName: string;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <RowModal
      trigger={trigger}
      triggerLabel={`Asignar chofer a ${tituloNave}`}
      triggerClassName={triggerClassName}
      modalClassName="jornada-modal"
      eyebrow="Asignar chofer por el día"
      title={`${tituloNave} · ${diaTexto}`}
      subtitle="Se le asignan los servicios que tildes de esa nave en el día."
      open={abierto}
      onOpenChange={setAbierto}
    >
      {abierto ? <Formulario dia={dia} servicios={servicios} tituloNave={tituloNave} choferes={choferes} vehicleId={vehicleId} /> : null}
    </RowModal>
  );
}

function Formulario({ dia, servicios, tituloNave, choferes, vehicleId }: {
  dia: string; servicios: ServicioVista[]; tituloNave: string; choferes: ChoferVista[]; vehicleId: string;
}) {
  const [estado, despachar, guardando] = useActionState<AsignarChoferState, FormData>(asignarChoferANaveAction, {});
  const [driverId, setDriverId] = useState("");
  const [buscar, setBuscar] = useState("");
  const [tildes, setTildes] = useState<Record<string, boolean>>({});

  const deLaNave = useMemo(() => servicios.filter((s) => s.vehicleId === vehicleId).sort((a, b) => a.desde - b.desde), [servicios, vehicleId]);
  const nombreDe = (id: string | null) => (id ? choferes.find((c) => c.id === id)?.nombre ?? "otro chofer" : null);
  const tildado = (servicio: ServicioVista) => tildes[servicio.clave] ?? vieneTildado(servicio, driverId);
  const cuantos = deLaNave.filter((s) => s.asignable && tildado(s)).length;

  /** Lo que el chofer ya maneja en otra nave a la hora de algún servicio de esta. */
  const cruces = (id: string, enLaNave: ServicioVista[]) => {
    const suyos = servicios.filter((s) => s.driverId === id && s.vehicleId !== vehicleId);
    return enLaNave.filter((s) => suyos.some((o) => o.desde < s.hasta && s.desde < o.hasta));
  };

  // Elegir el chofer (desde una nave): los que no se cruzan primero, y entre ellos los que menos manejan.
  const opcionesChofer = useMemo(() => {
    const filtro = sinTildes(buscar.trim());
    return choferes
      .filter((c) => !filtro || sinTildes(c.nombre).includes(filtro))
      .map((c) => ({ chofer: c, cruce: cruces(c.id, deLaNave).length, servicios: servicios.filter((s) => s.driverId === c.id).length }))
      .sort((a, b) => Number(a.cruce > 0) - Number(b.cruce > 0) || a.servicios - b.servicios || a.chofer.nombre.localeCompare(b.chofer.nombre, "es"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choferes, servicios, deLaNave, buscar]);

  const elegirChofer = (id: string) => { setDriverId(id); setTildes({}); };
  const listo = Boolean(vehicleId && driverId);
  const crucesElegidos = listo ? cruces(driverId, deLaNave.filter(tildado)) : [];

  return (
    <form
      className="jornada-form"
      onSubmit={(event) => {
        event.preventDefault();
        const datos = new FormData(event.currentTarget, event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : undefined);
        startTransition(() => despachar(datos));
      }}
    >
      <input type="hidden" name="dia" value={dia} />
      <input type="hidden" name="driverId" value={driverId} />
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <fieldset disabled={guardando} className="jornada-pasos">
        <section className="jornada-paso">
            <h3><span>1</span> Chofer</h3>
            {!driverId ? (
              <>
                <input className="jornada-buscar" type="search" placeholder="Buscar chofer" value={buscar} onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar chofer" autoFocus />
                <ul className="jornada-opciones" role="list">
                  {opcionesChofer.map(({ chofer, cruce, servicios: suyos }) => (
                    <li key={chofer.id}>
                      <button type="button" className="jornada-opcion" onClick={() => elegirChofer(chofer.id)}>
                        <span className="jornada-avatar" aria-hidden>{chofer.iniciales}</span>
                        <strong>{chofer.nombre}</strong>
                        <span className="jornada-opcion-chips">
                          {cruce ? <em data-tono="alerta">Maneja otra nave a esa hora</em> : <em data-tono="ok">{suyos ? "Libre a esa hora" : "Libre todo el día"}</em>}
                          {suyos ? <em>{suyos} {suyos === 1 ? "servicio" : "servicios"} ese día</em> : null}
                        </span>
                      </button>
                    </li>
                  ))}
                  {!opcionesChofer.length ? <li className="muted">No hay choferes con ese nombre.</li> : null}
                </ul>
              </>
            ) : (
              <p className="jornada-elegido">
                <strong>{nombreDe(driverId)}</strong>
                <button type="button" className="jornada-cambiar" onClick={() => { setDriverId(""); setBuscar(""); }}>Cambiar</button>
              </p>
            )}
        </section>

        {listo ? (
          <section className="jornada-paso">
            <h3><span>2</span> Servicios de {tituloNave} ese día</h3>
            {deLaNave.length ? (
              <ul className="jornada-servicios" role="list">
                {deLaNave.map((servicio) => {
                  const otro = servicio.driverId && servicio.driverId !== driverId ? nombreDe(servicio.driverId) : null;
                  const cruza = cruces(driverId, [servicio]).length > 0;
                  return (
                    <li key={servicio.clave} data-area={servicio.area}>
                      <label className="jornada-servicio" data-bloqueado={!servicio.asignable || undefined}>
                        <input
                          type="checkbox"
                          name="servicio"
                          value={servicio.clave}
                          disabled={!servicio.asignable}
                          checked={servicio.asignable && tildado(servicio)}
                          onChange={(e) => setTildes((previos) => ({ ...previos, [servicio.clave]: e.target.checked }))}
                        />
                        <span className="jornada-servicio-hora">{servicio.horario}</span>
                        <span className="jornada-servicio-texto">
                          <strong>{servicio.titulo}</strong>
                          <small>
                            {ETIQUETA_AREA[servicio.area]}
                            {" · "}
                            {!servicio.asignable
                              ? "se asigna desde su tablero"
                              : servicio.driverId === driverId
                                ? "ya es suyo"
                                : otro
                                  ? `hoy lo maneja ${otro}`
                                  : "sin chofer"}
                          </small>
                        </span>
                        {cruza ? <em className="jornada-servicio-aviso">Se cruza con otra nave suya</em> : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted">Esa nave no tiene servicios cargados ese día. Primero cargá el servicio (salida, vuelo o viaje) con esta nave.</p>
            )}
          </section>
        ) : null}

        {estado.error ? <p className="form-alert error" role="alert">{estado.error}</p> : null}
        <FleetConflictWarning conflicts={estado.conflicts} confirmation={estado.confirmation} />

        {listo && deLaNave.length ? (
          <div className="jornada-pie">
            <span>
              {cuantos ? `${cuantos} ${cuantos === 1 ? "servicio" : "servicios"} para ${nombreDe(driverId)}` : "Tildá al menos un servicio"}
              {crucesElegidos.length ? <small> · revisá los cruces antes de guardar</small> : null}
            </span>
            <button className="button" type="submit" disabled={!cuantos || guardando}>{guardando ? "Guardando…" : `Asignar a ${nombreDe(driverId)?.split(" ")[0]}`}</button>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
