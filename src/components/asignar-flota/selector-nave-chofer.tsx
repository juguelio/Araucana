"use client";

import { useId, useState } from "react";
import { ordenDeOpcion, type EstadoDeOpcion } from "@/lib/fleet/ocupacion";
import { tituloDeNave } from "@/lib/fleet/titulo-de-nave";
import "./selector-nave-chofer.css";

export type NaveOpcion = {
  id: string;
  name: string;
  internalNumber: string | null;
  licensePlate: string | null;
  /** Lugares que vende para este servicio (en el aeropuerto, las chicas dejan 4 para el equipaje). */
  seats?: number;
};

export type ChoferOpcion = {
  id: string;
  /** Nombre, o el email si no tiene nombre cargado. */
  label: string;
  email: string;
};

const normalizar = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();


function detalleDeNave(nave: NaveOpcion, seatsLabel: string) {
  const repiteInterno = nave.internalNumber && nave.name.trim() === nave.internalNumber.trim();
  return [
    !repiteInterno && nave.internalNumber ? `Int. ${nave.internalNumber}` : null,
    nave.licensePlate,
    // Una unidad sin plano no vende nada: decir «0 lugares» parece un cupo lleno.
    nave.seats == null ? null : nave.seats > 0 ? `${nave.seats} ${seatsLabel}` : "sin butacas cargadas"
  ]
    .filter(Boolean)
    .join(" · ");
}

type Chip = { texto: string; tono: "actual" | "libre" | "posible" | "ocupada" | "aviso" };

/**
 * El estado de una opción. Sin datos de ocupación (`ocupacion` undefined) no se dice «Libre»: no se
 * sabe, y decirlo sería afirmar algo que no se miró.
 */
function chipDe(id: string, actual: string, ocupacion: Record<string, EstadoDeOpcion> | undefined, extra?: Chip | null): Chip | null {
  const estado = ocupacion?.[id];
  if (estado?.estado === "ocupada") return { texto: `Ocupada · ${estado.detalle}`, tono: "ocupada" };
  if (estado?.estado === "posible") return { texto: `Posible cruce · ${estado.detalle}`, tono: "posible" };
  if (id === actual) return { texto: "Asignada ahora", tono: "actual" };
  return extra ?? (ocupacion ? { texto: "Libre", tono: "libre" } : null);
}

function Lista<T extends { id: string }>({
  titulo,
  placeholder,
  opciones,
  textoDe,
  render,
  seleccion,
  onElegir,
  actual,
  ocupacion,
  sinElegir,
  servicio
}: {
  titulo: string;
  placeholder: string;
  opciones: T[];
  textoDe: (opcion: T) => string;
  render: (opcion: T) => { nombre: string; detalle: string; chip: Chip | null };
  seleccion: string;
  onElegir: (id: string) => void;
  actual: string;
  ocupacion: Record<string, EstadoDeOpcion>;
  /** «Sin chofer»: opción vacía siempre arriba (null = no se ofrece). */
  sinElegir: { nombre: string; detalle: string } | null;
  servicio: string;
}) {
  const grupo = useId();
  const [busqueda, setBusqueda] = useState("");
  const [verOcupadas, setVerOcupadas] = useState(false);
  const termino = normalizar(busqueda);
  const ordenadas = [...opciones]
    .filter((opcion) => !termino || normalizar(textoDe(opcion)).includes(termino))
    .sort((a, b) => ordenDeOpcion(a.id, actual, ocupacion) - ordenDeOpcion(b.id, actual, ocupacion));
  // Las ocupadas a esa hora quedan plegadas: casi nunca son la respuesta. Al buscar, o si la elegida
  // está ocupada, se ven todas.
  const esOcupada = (opcion: T) => ocupacion[opcion.id]?.estado === "ocupada" && opcion.id !== seleccion && opcion.id !== actual;
  const plegar = !termino && !verOcupadas;
  const visibles = plegar ? ordenadas.filter((opcion) => !esOcupada(opcion)) : ordenadas;
  const ocultas = ordenadas.length - visibles.length;

  const fila = (id: string, nombre: string, detalle: string, chip: Chip | null) => (
    <label key={id || "ninguna"} className="flota-opcion" data-tono={chip?.tono}>
      <input type="radio" name={grupo} checked={seleccion === id} onChange={() => onElegir(id)} />
      <span className="flota-opcion-texto">
        <strong>{nombre}</strong>
        {detalle ? <small>{detalle}</small> : null}
      </span>
      {chip ? <span className="flota-chip" data-tono={chip.tono}>{chip.texto}</span> : null}
    </label>
  );

  return (
    <div className="flota-columna">
      <label className="flota-buscar">
        <span>{titulo}</span>
        <input type="search" value={busqueda} onChange={(evento) => setBusqueda(evento.target.value)} placeholder={placeholder} autoComplete="off" aria-label={`${titulo} para ${servicio}`} />
      </label>
      <div className="flota-lista" role="radiogroup" aria-label={`${titulo} para ${servicio}`}>
        {sinElegir && !termino ? fila("", sinElegir.nombre, sinElegir.detalle, null) : null}
        {visibles.length === 0 && termino ? <p className="flota-vacio">Nada coincide con «{busqueda}».</p> : null}
        {visibles.map((opcion) => {
          const { nombre, detalle, chip } = render(opcion);
          return fila(opcion.id, nombre, detalle, chip);
        })}
        {ocultas > 0 ? (
          <button type="button" className="flota-ver-ocupadas" onClick={() => setVerOcupadas(true)}>
            Ver {ocultas} {ocultas === 1 ? "ocupada" : "ocupadas"} a esa hora
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Elegir nave y chofer para un servicio (24-nov): el mismo selector en Servicio público, Naves en vivo
 * y Aeropuerto. Cada opción dice si está libre a la hora del servicio o en qué está; la asignada
 * ahora va primero, las ocupadas quedan plegadas, y abajo se ve qué se va a guardar antes de tocar el
 * botón. Manda `vehicleId` y `driverId` en el formulario que lo contiene; el chequeo de cruces al
 * guardar sigue siendo el del servidor.
 */
export function SelectorNaveYChofer({
  servicio,
  naves,
  choferes,
  ocupacionNaves,
  ocupacionChoferes,
  naveActual = "",
  choferActual = "",
  lugaresQueFaltan = null,
  seatsLabel = "lugares",
  boton,
  conChofer = true
}: {
  /** Para leer en voz alta: «Salida 10:00 San Martín → Villa Traful». */
  servicio: string;
  naves: NaveOpcion[];
  choferes: ChoferOpcion[];
  ocupacionNaves?: Record<string, EstadoDeOpcion>;
  ocupacionChoferes?: Record<string, EstadoDeOpcion>;
  naveActual?: string;
  choferActual?: string;
  /** Pasajeros que todavía no tienen lugar: una nave más chica se marca «no alcanza». */
  lugaresQueFaltan?: number | null;
  seatsLabel?: string;
  boton: string;
  conChofer?: boolean;
}) {
  const [nave, setNave] = useState(naveActual);
  const [chofer, setChofer] = useState(choferActual);
  const naveElegida = naves.find((opcion) => opcion.id === nave);
  const choferElegido = choferes.find((opcion) => opcion.id === chofer);
  const sinCambios = nave === naveActual && chofer === choferActual && Boolean(naveActual);

  return (
    <div className="flota-selector">
      <input type="hidden" name="vehicleId" value={nave} />
      {conChofer ? <input type="hidden" name="driverId" value={chofer} /> : null}
      <div className="flota-columnas" data-una={!conChofer || undefined}>
        <Lista
          titulo="Nave"
          placeholder="Buscar por interno, patente o nombre"
          opciones={naves}
          textoDe={(opcion) => [opcion.name, opcion.internalNumber, opcion.licensePlate].filter(Boolean).join(" ")}
          render={(opcion) => ({
            nombre: tituloDeNave(opcion),
            detalle: detalleDeNave(opcion, seatsLabel),
            chip: chipDe(
              opcion.id,
              naveActual,
              ocupacionNaves,
              lugaresQueFaltan && opcion.seats != null && opcion.seats > 0 && opcion.seats < lugaresQueFaltan
                ? { texto: `No alcanza: faltan ${lugaresQueFaltan} lugares`, tono: "aviso" }
                : null
            )
          })}
          seleccion={nave}
          onElegir={setNave}
          actual={naveActual}
          ocupacion={ocupacionNaves ?? {}}
          sinElegir={null}
          servicio={servicio}
        />
        {conChofer ? (
          <Lista
            titulo="Chofer"
            placeholder="Buscar por nombre o email"
            opciones={choferes}
            textoDe={(opcion) => `${opcion.label} ${opcion.email}`}
            render={(opcion) => ({
              nombre: opcion.label,
              detalle: opcion.label !== opcion.email ? opcion.email : "",
              chip: chipDe(opcion.id, choferActual, ocupacionChoferes)
            })}
            seleccion={chofer}
            onElegir={setChofer}
            actual={choferActual}
            ocupacion={ocupacionChoferes ?? {}}
            sinElegir={{ nombre: "Sin chofer", detalle: "Se puede asignar después" }}
            servicio={servicio}
          />
        ) : null}
      </div>

      <div className="flota-resumen">
        <p aria-live="polite">
          <span>Nave: <strong>{naveElegida ? tituloDeNave(naveElegida) : "elegí una"}</strong></span>
          {conChofer ? <span>Chofer: <strong>{choferElegido ? choferElegido.label : "sin chofer"}</strong></span> : null}
          {naveElegida && ocupacionNaves?.[naveElegida.id]?.estado === "ocupada" ? (
            <span className="flota-resumen-aviso">La nave está en otro servicio a esa hora: al guardar te avisa del cruce.</span>
          ) : choferElegido && ocupacionChoferes?.[choferElegido.id]?.estado === "ocupada" ? (
            <span className="flota-resumen-aviso">El chofer está en otro servicio a esa hora: al guardar te avisa del cruce.</span>
          ) : null}
        </p>
        <button className="button" type="submit" disabled={!nave || sinCambios}>
          {boton}
        </button>
      </div>
    </div>
  );
}
