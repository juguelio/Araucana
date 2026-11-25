"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FleetConflictWarning } from "@/app/admin/fleet-assignment-form";
import { RowModal } from "@/app/admin/reservas/row-modal";
import type { PendingTrip } from "@/lib/driver/assign-trip-types";
import type { NaveVista } from "./asignar-jornada";
import { asignarViajeAction, cargarViajesPendientes } from "./asignar-viaje-action";

type Props = { dia: string; fechaTexto: string; driverId: string; nombre: string; origen: "listado" | "ficha" };
const clave = (trip: PendingTrip) => `${trip.day}:${trip.kind}:${trip.id}`;
const normalizar = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").trim();
const rubroPorTipo = {
  airport: "Aeropuerto", private: "Aeropuerto", schedule: "Servicio público",
  special: "Viajes especiales", school: "Concesiones", chapelco: "Chapelco"
} satisfies Record<PendingTrip["kind"], string>;

const hora = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Salta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function detalle(viaje: PendingTrip) {
  const conHora = viaje.kind === "airport" || viaje.kind === "private";
  return [viaje.day.split("-").reverse().join("/"), conHora ? hora.format(viaje.startsAt) : null, viaje.detail].filter(Boolean).join(" · ");
}

export function AsignarViaje(props: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [opciones, setOpciones] = useState<Awaited<ReturnType<typeof cargarViajesPendientes>> | null>(null);
  const [cargando, iniciarCarga] = useTransition();
  function cargar() {
    iniciarCarga(async () => {
      try {
        setOpciones(await cargarViajesPendientes(props.dia));
      } catch {
        setOpciones(null);
      }
    });
  }
  function abrir(abierto: boolean) {
    setOpen(abierto);
    if (abierto) cargar();
  }
  function mostrarAsignacion(day: string) {
    setOpen(false);
    const params = new URLSearchParams({ dia: day, notice: "Viaje asignado al chofer con la nave elegida." });
    const destino = props.origen === "listado" ? "/admin/choferes" : `/admin/choferes/${props.driverId}/actividad`;
    router.push(`${destino}?${params}`);
  }
  return (
    <RowModal trigger="Asignar viaje" triggerLabel={`Asignar viaje a ${props.nombre}`}
      triggerClassName="ghost-button choferes-asignar" modalClassName="jornada-modal" eyebrow={props.fechaTexto}
      title={`Asignar viaje a ${props.nombre}`} open={open} onOpenChange={abrir}>
      {open && (cargando
        ? <p role="status">Buscando viajes sin nave…</p>
        : opciones ? <ElegirViaje {...props} {...opciones} onSaved={mostrarAsignacion} />
        : <div><p role="alert">No se pudieron cargar los viajes.</p><button type="button" className="ghost-button" onClick={cargar}>Reintentar</button></div>)}
    </RowModal>
  );
}

type AlGuardar = { onSaved: (day: string) => void };

function ElegirViaje({ dia, driverId, nombre, viajes, naves, onSaved }: Props & { viajes: PendingTrip[]; naves: NaveVista[] } & AlGuardar) {
  const [elegido, elegir] = useState<PendingTrip | null>(null);
  if (!viajes.length) return <p role="status">No hay viajes pendientes de nave desde el {dia.split("-").reverse().join("/")}.</p>;
  return <>
    <div hidden={elegido !== null}>
      <BuscarViaje dia={dia} viajes={viajes} onElegir={elegir} />
    </div>
    {elegido && <div className="jornada-pasos">
      <div className="jornada-elegido"><div><strong>{elegido.title}</strong><br /><small>{elegido.service} · {detalle(elegido)}</small></div>
        <button type="button" className="jornada-cambiar" onClick={() => elegir(null)}>Cambiar viaje</button>
      </div>
      <ElegirNave viaje={elegido} driverId={driverId} nombre={nombre} naves={naves} onSaved={onSaved} />
    </div>}
  </>;
}

type SelectorDeViajes = { viajes: PendingTrip[]; onElegir: (viaje: PendingTrip) => void };

function BuscarViaje({ dia, viajes, onElegir }: SelectorDeViajes & { dia: string }) {
  const [buscar, setBuscar] = useState("");
  const [fecha, setFecha] = useState("");
  const consulta = normalizar(buscar);
  const porRubro = new Map<string, PendingTrip[]>();
  for (const viaje of viajes) {
    if (fecha && viaje.day !== fecha) continue;
    const rubro = rubroPorTipo[viaje.kind];
    if (consulta && !normalizar(`${viaje.title} ${viaje.service} ${detalle(viaje)} ${rubro}`).includes(consulta)) continue;
    const grupo = porRubro.get(rubro);
    if (grupo) grupo.push(viaje);
    else porRubro.set(rubro, [viaje]);
  }
  const grupos = [...porRubro].sort(([a], [b]) => a.localeCompare(b, "es"));
  return <section className="jornada-paso">
    <h3>Viajes sin nave</h3>
    <label className="jornada-fecha">Filtrar por día
      <input type="date" value={fecha} min={dia} onChange={(e) => setFecha(e.target.value)} />
    </label>
    <input type="search" className="jornada-buscar" aria-label="Buscar viaje" placeholder="Buscar por recorrido, servicio u horario"
      autoFocus value={buscar} onChange={(e) => setBuscar(e.target.value)} />
    {grupos.length ? <div className="jornada-rubros" key={`${fecha}:${consulta}`}>
      {grupos.map(([rubro, pendientes]) => <ViajesDelRubro key={rubro} rubro={rubro} viajes={pendientes}
        abiertoAlInicio={Boolean(consulta || fecha) || grupos.length === 1} onElegir={onElegir} />)}
    </div> : <p role="status">Ningún viaje coincide con la búsqueda.</p>}
  </section>;
}

function ViajesDelRubro({ rubro, viajes, abiertoAlInicio, onElegir }: SelectorDeViajes & { rubro: string; abiertoAlInicio: boolean }) {
  const [limite, setLimite] = useState(40);
  return <details className="jornada-rubro" open={abiertoAlInicio}>
    <summary>{rubro} <small>{viajes.length} {viajes.length === 1 ? "viaje" : "viajes"}</small></summary>
    <ul className="jornada-opciones" aria-label={rubro}>
      {viajes.slice(0, limite).map((viaje) => <li key={clave(viaje)}>
        <button type="button" className="jornada-opcion" onClick={() => onElegir(viaje)}>
          <strong>{viaje.title}</strong><small>{viaje.kind === "private" && "Privado · "}{detalle(viaje)}</small>
        </button>
      </li>)}
    </ul>
    {viajes.length > limite && <button type="button" className="ghost-button" onClick={() => setLimite(limite + 40)}>Ver más viajes</button>}
  </details>;
}

function ElegirNave({ viaje, driverId, nombre, naves, onSaved }: Pick<Props, "driverId" | "nombre"> & { viaje: PendingTrip; naves: NaveVista[] } & AlGuardar) {
  const [vehicleId, setVehicleId] = useState("");
  return <div className="jornada-paso">
    <label htmlFor="viaje-nave"><strong>Nave para el viaje</strong></label>
    <select className="jornada-buscar" id="viaje-nave" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
      <option value="">Elegí una nave</option>
      {naves.map((n) => <option key={n.id} value={n.id}>{[n.titulo, n.detalle].filter(Boolean).join(" · ")}</option>)}
    </select>
    {!naves.length && <p role="status">No hay naves de pasajeros activas.</p>}
    {vehicleId && <Confirmar key={vehicleId} viaje={viaje} driverId={driverId} nombre={nombre} vehicleId={vehicleId} onSaved={onSaved} />}
  </div>;
}

function Confirmar({ viaje, driverId, nombre, vehicleId, onSaved }: Pick<Props, "driverId" | "nombre"> & { viaje: PendingTrip; vehicleId: string } & AlGuardar) {
  const [estado, enviar, guardando] = useActionState(async (_previo: unknown, form: FormData) => {
    const resultado = await asignarViajeAction(form);
    if ("saved" in resultado) onSaved(viaje.day);
    return resultado;
  }, null);
  return <form action={enviar}>
    <input type="hidden" name="kind" value={viaje.kind} />
    <input type="hidden" name="id" value={viaje.id} />
    <input type="hidden" name="day" value={viaje.day} />
    <input type="hidden" name="driverId" value={driverId} />
    <input type="hidden" name="vehicleId" value={vehicleId} />
    <fieldset className="jornada-pasos" disabled={guardando}>
      {estado && "error" in estado && <p className="form-alert error" role="alert">{estado.error}</p>}
      {estado && "conflicts" in estado && <FleetConflictWarning {...estado} />}
      <div className="jornada-pie"><span>Chofer · {nombre}</span>
        <button type="submit" className="button">{guardando ? "Guardando…" : "Asignar viaje"}</button>
      </div>
    </fieldset>
  </form>;
}
