"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  camposParaElSiguiente, mismoNombre, nombreParaLista, progresoDeCarga,
  type CampoQueSeRepite, type PasajeroDeLaLista
} from "@/lib/departure-sheets/carga";
import { documentTypeLabels, documentTypes, sexLabels, sexOptions } from "@/lib/departure-sheets/types";
import { submitDeparturePassengerAction } from "./actions";
import { initialSubmitState, type SubmitDeparturePassengerState } from "./state";
import "./planilla.css";

export type PlanillaPrefill = {
  firstName: string;
  lastName: string;
  documentType: string;
  documentNumber: string;
  nationality: string;
};

type PlanillaCargaProps = {
  token: string;
  kind: string;
  countries: string[];
  pasajeros: PasajeroDeLaLista[];
  /** Pasajeros del viaje, si la agencia los cargó: para «12 de 30». */
  esperados: number | null;
  /** Datos que ya tiene la reserva: el pasajero sólo confirma y completa lo que falta. */
  prefill?: PlanillaPrefill;
};

/**
 * Carga de la planilla (rediseño del 25-nov, pedido de Jugue: «que se vean mientras ingresás todos
 * los nombres»). El formulario y la lista van juntos: en la computadora la lista queda fija al
 * costado; en el teléfono es una barra arriba que se despliega. Lo que se escribe aparece como el
 * próximo renglón, se avisa si ese nombre ya está, y al guardar el formulario queda listo para el
 * siguiente, con el tipo de documento, la nacionalidad y el país de residencia del anterior.
 */
export function PlanillaCarga({ token, kind, countries, pasajeros, esperados, prefill }: PlanillaCargaProps) {
  const router = useRouter();
  const [repetir, setRepetir] = useState<Partial<Record<CampoQueSeRepite, string>>>({});
  const [vuelta, setVuelta] = useState(0);
  const [escrito, setEscrito] = useState({ apellido: prefill?.lastName ?? "", nombre: prefill?.firstName ?? "" });
  const [state, formAction, pending] = useActionState(
    async (previo: SubmitDeparturePassengerState, form: FormData) => {
      const resultado = await submitDeparturePassengerAction(previo, form);
      if (resultado.status === "ok") {
        // Formulario nuevo para el siguiente, con lo que suele repetirse en el grupo.
        setRepetir(camposParaElSiguiente(form));
        setEscrito({ apellido: "", nombre: "" });
        setVuelta((n) => n + 1);
      }
      return resultado;
    },
    initialSubmitState
  );

  useEffect(() => {
    if (state.status === "ok") router.refresh();
  }, [state, router]);

  const coincide = mismoNombre(pasajeros, escrito.apellido, escrito.nombre);
  const borrador = escrito.apellido.trim() || escrito.nombre.trim() ? nombreParaLista(escrito.apellido, escrito.nombre) : null;
  const asksResidence = kind === "PROVINCIA";
  const tipoInicial = repetir.documentType ?? (documentTypes.includes(prefill?.documentType as (typeof documentTypes)[number]) ? prefill?.documentType : "DNI");
  const primera = vuelta === 0;

  return (
    <div className="planilla-carga">
      <ListaDePasajeros
        pasajeros={pasajeros}
        esperados={esperados}
        resaltado={state.status === "ok" ? state.passengerId : undefined}
        borrador={coincide ? null : borrador}
        coincide={coincide?.id}
      />

      <form
        key={vuelta}
        className="form-panel planilla-panel planilla-form"
        id="formulario"
        onSubmit={(event) => {
          event.preventDefault();
          const datos = new FormData(event.currentTarget);
          startTransition(() => formAction(datos));
        }}
      >
        <input type="hidden" name="token" value={token} />
        <div className="planilla-form-cabeza">
          <p className="eyebrow">{primera ? "Cargar pasajero" : "Siguiente pasajero"}</p>
          <h2>Pasajero Nº {pasajeros.length + 1}</h2>
        </div>

        {state.status === "ok" ? (
          <p className="planilla-ok" role="status" aria-live="polite">
            <strong>✓ {state.position ? `Nº ${state.position} · ` : ""}{state.passengerName}</strong>
            {state.updated ? " — actualizamos sus datos (ya estaba con ese documento)." : " quedó en la planilla."}{" "}
            Seguí con el siguiente.
          </p>
        ) : null}

        <div className="planilla-grid">
          <label>
            Apellido
            <input
              name="lastName" required minLength={2} maxLength={60} autoComplete="family-name"
              defaultValue={primera ? prefill?.lastName ?? "" : ""}
              autoFocus={!primera}
              onChange={(e) => setEscrito((previo) => ({ ...previo, apellido: e.target.value }))}
            />
          </label>
          <label>
            Nombre
            <input
              name="firstName" required minLength={2} maxLength={60} autoComplete="given-name"
              defaultValue={primera ? prefill?.firstName ?? "" : ""}
              onChange={(e) => setEscrito((previo) => ({ ...previo, nombre: e.target.value }))}
            />
          </label>
          {coincide ? (
            <p className="planilla-aviso" role="status">
              Ya hay un <strong>{coincide.nombre}</strong> en la planilla (Nº {coincide.position}). Si es la misma persona, cargala con
              el mismo documento ({coincide.documento}): se actualiza y no queda repetida.
            </p>
          ) : null}
          <label>
            Tipo de documento
            <select name="documentType" defaultValue={tipoInicial} required>
              {documentTypes.map((type) => (
                <option value={type} key={type}>{documentTypeLabels[type]}</option>
              ))}
            </select>
          </label>
          <label>
            Número de documento
            <input name="documentNumber" required maxLength={30} inputMode="text" autoComplete="off" defaultValue={primera ? prefill?.documentNumber ?? "" : ""} />
          </label>
          <label>
            Sexo
            <select name="sex" defaultValue="" required>
              <option value="" disabled>Elegí una opción</option>
              {sexOptions.map((sex) => (
                <option value={sex} key={sex}>{sexLabels[sex]}</option>
              ))}
            </select>
          </label>
          <label>
            Fecha de nacimiento
            <input type="date" name="birthDate" required min="1900-01-01" />
          </label>
          <label>
            Nacionalidad
            <input
              name="nationality" required minLength={2} maxLength={60} list="planilla-paises" placeholder="Argentina"
              defaultValue={repetir.nationality ?? prefill?.nationality ?? ""}
            />
          </label>
          {asksResidence ? (
            <label>
              Ocupación
              <input name="occupation" required minLength={2} maxLength={80} placeholder="Ej. Docente" />
            </label>
          ) : null}
          {asksResidence ? (
            <label>
              País de residencia
              <input name="residenceCountry" required minLength={2} maxLength={60} list="planilla-paises" placeholder="Argentina" defaultValue={repetir.residenceCountry ?? ""} />
            </label>
          ) : null}
        </div>

        <datalist id="planilla-paises">
          {countries.map((country) => (
            <option value={country} key={country} />
          ))}
        </datalist>

        {state.status === "error" ? (
          <p className="form-alert" role="alert">{state.message}</p>
        ) : null}

        <div className="planilla-form-pie">
          <button className="button" type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Guardar y cargar el siguiente"}
          </button>
          {!primera && Object.keys(repetir).length ? (
            <span className="muted">Dejamos el tipo de documento y la nacionalidad del anterior: cambialos si no corresponden.</span>
          ) : null}
        </div>
      </form>
    </div>
  );
}

/**
 * La lista de la planilla, siempre a la vista. En el teléfono arranca plegada en una barra con el
 * progreso y el último cargado; se despliega con un toque.
 */
export function ListaDePasajeros({
  pasajeros,
  esperados,
  resaltado,
  borrador,
  coincide
}: {
  pasajeros: PasajeroDeLaLista[];
  esperados: number | null;
  resaltado?: string;
  borrador?: string | null;
  coincide?: string;
}) {
  const [abierta, setAbierta] = useState(false);
  const lista = useRef<HTMLOListElement>(null);
  const progreso = progresoDeCarga(pasajeros.length, esperados);
  const ultimo = pasajeros.find((p) => p.id === resaltado) ?? pasajeros[pasajeros.length - 1];

  // La lista baja sola al final: el último cargado y el que se está escribiendo quedan a la vista.
  useEffect(() => {
    const ol = lista.current;
    if (!ol) return;
    const objetivo = coincide ? ol.querySelector<HTMLElement>(`[data-id="${coincide}"]`) : null;
    if (objetivo) objetivo.scrollIntoView({ block: "nearest" });
    else ol.scrollTop = ol.scrollHeight;
  }, [pasajeros.length, borrador, coincide, abierta]);

  return (
    <aside className="planilla-lista" data-abierta={abierta || undefined} aria-labelledby="pasajeros-cargados">
      <button type="button" className="planilla-lista-barra" onClick={() => setAbierta((a) => !a)} aria-expanded={abierta} aria-controls="planilla-lista-cuerpo">
        <span className="planilla-lista-titulo">
          <strong id="pasajeros-cargados">{progreso.texto}</strong>
          {borrador ? (
            <small data-borrador>Cargando Nº {pasajeros.length + 1}: {borrador}</small>
          ) : coincide ? (
            <small data-coincide>Ya está: {pasajeros.find((p) => p.id === coincide)?.nombre}</small>
          ) : ultimo ? <small>Último: {ultimo.nombre}</small> : <small>Todavía no hay nadie</small>}
        </span>
        <span className="planilla-lista-ver" aria-hidden>{abierta ? "Ocultar ▴" : "Ver lista ▾"}</span>
      </button>
      {progreso.porcentaje !== null ? (
        <div className="planilla-progreso" data-completa={progreso.completa || undefined}>
          <span style={{ width: `${progreso.porcentaje}%` }} />
        </div>
      ) : null}
      <div className="planilla-lista-cuerpo" id="planilla-lista-cuerpo">
        <div className="planilla-lista-head">
          <h2>Pasajeros en la planilla</h2>
          {progreso.detalle ? <span className="pill" data-completa={progreso.completa || undefined}>{progreso.detalle}</span> : null}
        </div>
        <ol className="planilla-pasajeros" ref={lista}>
          {pasajeros.map((pasajero) => (
            <li key={pasajero.id} data-id={pasajero.id} data-nuevo={pasajero.id === resaltado || undefined} data-coincide={pasajero.id === coincide || undefined}>
              <span className="planilla-pasajero-num">{pasajero.position}</span>
              <div>
                <strong>{pasajero.nombre}</strong>
                <span>{pasajero.documento} · {pasajero.nationality}</span>
              </div>
              {pasajero.id === resaltado ? <em>Recién cargado</em> : null}
            </li>
          ))}
          {borrador ? (
            <li data-borrador aria-live="polite">
              <span className="planilla-pasajero-num">{pasajeros.length + 1}</span>
              <div>
                <strong>{borrador}</strong>
                <span>Cargando…</span>
              </div>
            </li>
          ) : null}
          {!pasajeros.length && !borrador ? <li className="planilla-vacia">El primero que cargues aparece acá.</li> : null}
        </ol>
        <p className="muted planilla-lista-nota">
          ¿Un dato mal? Volvé a cargar a esa persona con el mismo documento: se actualiza.
        </p>
      </div>
    </aside>
  );
}
