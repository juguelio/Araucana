"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { tramoDeVuelo } from "@/lib/airport/airports";
import { airlineName } from "@/lib/airport/airlines";
import { AirlineBadge } from "@/components/airline-badge";

/**
 * Barra de búsqueda de ida y vuelta, al estilo de los buscadores de vuelos (pedido de Jugue,
 * 17-nov: «como en Kiwi», pensado para alguien de 70 años). Cuatro campos grandes —Desde, Hacia,
 * Ida y Vuelta— y cada uno abre debajo su propio panel: los lugares, o los días y los vuelos.
 * Todo se elige tocando; no hay que escribir nada.
 */

export type Sentido = "ARRIVAL" | "DEPARTURE";
export type Orden = Sentido;

export type VueloOpcion = {
  id: string;
  number: string;
  airline: string | null;
  origin?: string | null;
  scheduledAt: string;
  estimatedAt: string | null;
  available: number;
};

export type TramoDeLaBarra = {
  sentido: Sentido;
  /** «Ida» o «Vuelta»: el lugar del tramo en el viaje. */
  etapa: string;
  /** «Llegada a Chapelco» / «Salida desde San Martín». */
  titulo: string;
  pregunta: string;
  fecha: string;
  /** El primer día que se puede elegir ("" = sin límite). */
  minimo: string;
  opciones: VueloOpcion[];
  elegido: string;
  cargando: boolean;
};

type Lugar = "CPC" | "SMA";
type Campo = "desde" | "hacia" | Sentido;

const LUGARES: Record<Lugar, { nombre: string; detalle: string }> = {
  CPC: { nombre: "Aeropuerto Chapelco", detalle: "El aeropuerto (CPC)" },
  SMA: { nombre: "San Martín de los Andes", detalle: "Te buscamos o te dejamos donde estés" }
};

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DIAS_LARGOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function aFecha(dia: string) {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function aClave(fecha: Date) {
  return fecha.toISOString().slice(0, 10);
}

function sumarDias(dia: string, dias: number) {
  const fecha = aFecha(dia);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return aClave(fecha);
}

/** «mar 17 nov». */
export function diaCorto(dia: string) {
  const fecha = aFecha(dia);
  return `${DIAS[fecha.getUTCDay()]} ${fecha.getUTCDate()} ${MESES[fecha.getUTCMonth()]}`;
}

function diaLargo(dia: string) {
  const fecha = aFecha(dia);
  return `${DIAS_LARGOS[fecha.getUTCDay()]} ${fecha.getUTCDate()}/${String(fecha.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Hora de Argentina (UTC−3, sin horario de verano). */
export function hora(iso: string) {
  return new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);
}

function hoyEnArgentina() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Qué orden queda si en «Desde» o «Hacia» se elige un lugar. */
export function ordenPara(campo: "desde" | "hacia", lugar: Lugar): Orden {
  if (campo === "desde") return lugar === "CPC" ? "ARRIVAL" : "DEPARTURE";
  return lugar === "SMA" ? "ARRIVAL" : "DEPARTURE";
}

function IconoAvion() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.2 13.8 4 12l-1.5 1.5 5.3 2.7 2.7 5.3L12 20l-1.8-6.2" />
      <path d="M10.2 13.8 19 5c.9-.9 2.2-.6 2.2-.6s.3 1.3-.6 2.2l-8.8 8.8" />
      <path d="m14.5 9.5 1.5 9 2-2-1-8.5M9.5 9 1 8l2-2 8.5 1" />
    </svg>
  );
}

function IconoPin() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

function IconoCalendario() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

export function TripSearchBar({
  orden, tramos, routeSlug, confirmarCambio,
  onPedirOrden, onConfirmarCambio, onCancelarCambio, onFecha, onVuelo
}: {
  orden: Orden;
  /** Los dos tramos en el orden del viaje: el de ida primero. */
  tramos: [TramoDeLaBarra, TramoDeLaBarra];
  routeSlug: string;
  confirmarCambio: boolean;
  /** Pedir un orden: si cambia y ya hay vuelos elegidos, el formulario pregunta antes. */
  onPedirOrden: (orden: Orden) => void;
  onConfirmarCambio: () => void;
  onCancelarCambio: () => void;
  onFecha: (sentido: Sentido, fecha: string) => void;
  onVuelo: (sentido: Sentido, id: string) => void;
}) {
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [abierto, setAbierto] = useState<Campo | null>(null);
  /** El primer día de la tira de cada tramo: se corre de a una semana con las flechas. */
  const [inicioTira, setInicioTira] = useState<Partial<Record<Sentido, string>>>({});

  const desde: Lugar = orden === "ARRIVAL" ? "CPC" : "SMA";
  const hacia: Lugar = orden === "ARRIVAL" ? "SMA" : "CPC";

  // Se cierra con Escape o tocando fuera de la barra, como cualquier menú.
  useEffect(() => {
    if (!abierto) return;
    function afuera(event: PointerEvent) {
      if (raiz.current && !raiz.current.contains(event.target as Node)) setAbierto(null);
    }
    function tecla(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const campo = abierto;
      setAbierto(null);
      raiz.current?.querySelector<HTMLButtonElement>(`[data-campo="${campo}"]`)?.focus();
    }
    document.addEventListener("pointerdown", afuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", afuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  // Al abrir un panel, el foco va a lo que está elegido (o a lo primero), para seguir con el teclado.
  useEffect(() => {
    if (!abierto) return;
    const panel = raiz.current?.querySelector<HTMLElement>(".trip-search-panel");
    const destino = panel?.querySelector<HTMLElement>("[aria-pressed='true'], [aria-checked='true']") ??
      panel?.querySelector<HTMLElement>("button:not([disabled])");
    destino?.focus({ preventScroll: true });
  }, [abierto]);

  function alternar(campo: Campo) {
    if (confirmarCambio) onCancelarCambio();
    setAbierto((actual) => (actual === campo ? null : campo));
  }

  function elegirLugar(campo: "desde" | "hacia", lugar: Lugar) {
    const nuevo = ordenPara(campo, lugar);
    if (nuevo !== orden) onPedirOrden(nuevo);
    // Se sigue al campo siguiente, como en Kiwi: de «Desde» a «Hacia», y de «Hacia» al día de ida
    // (el tramo de ida es siempre el del orden elegido). Si hay que confirmar, el panel espera.
    setAbierto(campo === "desde" ? "hacia" : nuevo);
  }

  function elegirVuelo(tramo: TramoDeLaBarra, vueloId: string) {
    onVuelo(tramo.sentido, vueloId);
    const otro = tramos.find((t) => t.sentido !== tramo.sentido)!;
    // Después de la ida se abre la vuelta, si todavía no tiene vuelo; si no, se cierra.
    setAbierto(tramo === tramos[0] && !otro.elegido ? otro.sentido : null);
  }

  const tramoAbierto = tramos.find((tramo) => tramo.sentido === abierto) ?? null;
  const panelId = `${id}-panel`;
  const hoy = hoyEnArgentina();

  function campoLugar(campo: "desde" | "hacia") {
    const lugar = campo === "desde" ? desde : hacia;
    return (
      <button
        type="button"
        className="trip-search-field trip-search-place"
        data-campo={campo}
        data-abierto={abierto === campo || undefined}
        aria-expanded={abierto === campo}
        aria-controls={panelId}
        onClick={() => alternar(campo)}
      >
        <span className="trip-search-label">{campo === "desde" ? "Desde" : "Hacia"}</span>
        <span className="trip-search-chip">
          {lugar === "CPC" ? <IconoAvion /> : <IconoPin />}
          {LUGARES[lugar].nombre}
        </span>
      </button>
    );
  }

  function campoTramo(tramo: TramoDeLaBarra) {
    const vuelo = tramo.opciones.find((opcion) => opcion.id === tramo.elegido) ?? null;
    return (
      <button
        key={tramo.sentido}
        type="button"
        className="trip-search-field trip-search-leg"
        data-campo={tramo.sentido}
        data-abierto={abierto === tramo.sentido || undefined}
        data-listo={Boolean(vuelo) || undefined}
        aria-expanded={abierto === tramo.sentido}
        aria-controls={panelId}
        onClick={() => alternar(tramo.sentido)}
      >
        <span className="trip-search-label">{tramo.etapa} · {tramo.sentido === "ARRIVAL" ? "Llegada" : "Salida"}</span>
        <span className="trip-search-value">
          {/* Con el vuelo elegido, el logo de la aerolínea dice más que el calendario. */}
          {vuelo ? <AirlineBadge code={vuelo.airline} size={28} /> : <IconoCalendario />}
          <span>
            {diaCorto(tramo.fecha)}
            {vuelo
              ? <b> · {hora(vuelo.estimatedAt ?? vuelo.scheduledAt)} {vuelo.number}</b>
              : <em> · elegir vuelo</em>}
          </span>
        </span>
      </button>
    );
  }

  function panelLugar(campo: "desde" | "hacia") {
    const actual = campo === "desde" ? desde : hacia;
    return (
      <>
        <p className="trip-search-panel-title">{campo === "desde" ? "¿Desde dónde sale?" : "¿Adónde va?"}</p>
        <div className="trip-search-places" role="radiogroup" aria-label={campo === "desde" ? "Desde" : "Hacia"}>
          {(["CPC", "SMA"] as const).map((lugar) => (
            <button
              key={lugar}
              type="button"
              role="radio"
              aria-checked={actual === lugar}
              className="trip-search-option"
              onClick={() => elegirLugar(campo, lugar)}
            >
              <span className="trip-search-option-icon">{lugar === "CPC" ? <IconoAvion /> : <IconoPin />}</span>
              <span className="trip-search-option-text">
                <b>{LUGARES[lugar].nombre}</b>
                <small>{LUGARES[lugar].detalle}</small>
              </span>
              {actual === lugar ? <span className="trip-search-tick" aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
      </>
    );
  }

  function panelTramo(tramo: TramoDeLaBarra) {
    const minimo = tramo.minimo || "";
    const pedido = inicioTira[tramo.sentido] ?? (minimo && tramo.fecha < minimo ? minimo : tramo.fecha);
    const inicio = minimo && pedido < minimo ? minimo : pedido;
    const dias = Array.from({ length: 7 }, (_, i) => sumarDias(inicio, i));
    const anterior = sumarDias(inicio, -7);
    const puedeVolver = !minimo || sumarDias(inicio, -1) >= minimo;
    const mover = (desdeDia: string) => setInicioTira((actual) => ({ ...actual, [tramo.sentido]: desdeDia }));
    return (
      <>
        <p className="trip-search-panel-title">{tramo.titulo}</p>
        <p className="trip-search-panel-help">{tramo.pregunta}</p>

        <p className="trip-search-step">1. El día</p>
        <div className="trip-search-days">
          <button type="button" className="trip-search-arrow" aria-label="Días anteriores" disabled={!puedeVolver}
            onClick={() => mover(minimo && anterior < minimo ? minimo : anterior)}>‹<span className="trip-search-arrow-text"> Días anteriores</span></button>
          <div className="trip-search-day-list">
            {dias.map((dia) => {
              const fecha = aFecha(dia);
              return (
                <button
                  key={dia}
                  type="button"
                  className="trip-search-day"
                  aria-pressed={dia === tramo.fecha}
                  aria-label={`${diaLargo(dia)}${dia === hoy ? ", hoy" : ""}`}
                  onClick={() => { if (dia !== tramo.fecha) onFecha(tramo.sentido, dia); }}
                >
                  <small>{dia === hoy ? "hoy" : DIAS[fecha.getUTCDay()]}</small>
                  <b>{fecha.getUTCDate()}</b>
                  <small>{MESES[fecha.getUTCMonth()]}</small>
                </button>
              );
            })}
          </div>
          <button type="button" className="trip-search-arrow" aria-label="Días siguientes"
            onClick={() => mover(sumarDias(inicio, 7))}><span className="trip-search-arrow-text">Días siguientes </span>›</button>
        </div>

        <p className="trip-search-step">2. El vuelo del {diaLargo(tramo.fecha)}</p>
        {tramo.cargando ? (
          <p className="trip-search-empty" role="status">Buscando vuelos…</p>
        ) : tramo.opciones.length === 0 ? (
          <p className="trip-search-empty">
            No hay vuelos para reservar ese día. Probá otro día, o si su vuelo no figura, reservá ese tramo solo desde{" "}
            <Link className="table-link" href={`/reservar/${routeSlug}?date=${tramo.fecha}`}>la reserva de un tramo</Link>.
          </p>
        ) : (
          <div className="trip-search-flights">
            {tramo.opciones.map((vuelo) => {
              const elegido = vuelo.id === tramo.elegido;
              // `origin` es el otro extremo del vuelo en los dos sentidos: «desde Aeroparque» / «hacia Aeroparque».
              const detalle = [airlineName(vuelo.airline), tramoDeVuelo({ direction: tramo.sentido, origin: vuelo.origin })]
                .filter(Boolean).join(" · ");
              return (
                <button
                  key={vuelo.id}
                  type="button"
                  className="trip-search-flight"
                  aria-pressed={elegido}
                  onClick={() => elegirVuelo(tramo, vuelo.id)}
                >
                  <b className="trip-search-flight-time">{hora(vuelo.estimatedAt ?? vuelo.scheduledAt)}</b>
                  {/* Logo de la aerolínea (pedido de Jugue, 17-nov): se reconoce antes que el número. */}
                  <AirlineBadge code={vuelo.airline} size={44} />
                  <span className="trip-search-flight-text">
                    <b>Vuelo {vuelo.number}</b>
                    {detalle ? <small>{detalle}</small> : null}
                  </span>
                  <span className="trip-search-flight-seats">
                    {elegido ? "✓ Elegido" : `${vuelo.available} ${vuelo.available === 1 ? "lugar" : "lugares"}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="trip-search" ref={raiz}>
      <div className="trip-search-bar">
        <div className="trip-search-places-row">
          {campoLugar("desde")}
          <button
            type="button"
            className="trip-search-swap"
            aria-label="Invertir: cambiar desde y hacia"
            title="Invertir"
            onClick={() => { setAbierto(null); onPedirOrden(orden === "ARRIVAL" ? "DEPARTURE" : "ARRIVAL"); }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 8h11" /><path d="m14 5 3 3-3 3" /><path d="M18 16H7" /><path d="m10 13-3 3 3 3" />
            </svg>
          </button>
          {campoLugar("hacia")}
        </div>
        {tramos.map(campoTramo)}
      </div>

      {confirmarCambio ? (
        <div className="trip-search-confirm" role="alert">
          <p><strong>¿Invertir el viaje?</strong> Los vuelos que ya eligió se borran y hay que elegirlos de nuevo.</p>
          <div className="trip-search-confirm-actions">
            <button type="button" className="button" onClick={() => { onConfirmarCambio(); setAbierto(null); }}>Sí, invertir</button>
            <button type="button" className="ghost-button" onClick={onCancelarCambio}>No, dejarlo así</button>
          </div>
        </div>
      ) : null}

      {abierto && !confirmarCambio ? (
        <div className="trip-search-panel" id={panelId} role="group" aria-label={tramoAbierto ? tramoAbierto.titulo : abierto === "desde" ? "Desde" : "Hacia"}>
          <button type="button" className="trip-search-close" aria-label="Cerrar" onClick={() => setAbierto(null)}>✕</button>
          {abierto === "desde" || abierto === "hacia" ? panelLugar(abierto) : tramoAbierto ? panelTramo(tramoAbierto) : null}
        </div>
      ) : null}
    </div>
  );
}
