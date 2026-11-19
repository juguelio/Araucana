"use client";

import { useEffect, useId, useRef, useState } from "react";
import { diasConSalidas, type SalidaOption } from "./salida-picker-utils";
import { conteoPorDia, tiraConServicio, type Lugar } from "./viaje-utils";

/**
 * El recuadro del viaje de «Nueva reserva», con el template del aeropuerto (pedido de Jugue, 18-nov:
 * «adaptá esta página al nuevo template»). Mismas piezas y mismas clases que `TripSearchBar`:
 * - Desde ⇄ Hacia: cada uno abre la lista de lugares; ⇄ invierte si hay salidas en el otro sentido.
 * - Siempre dos fechas, mitad y mitad: la ida y la vuelta. Sin vuelta, la segunda está apagada
 *   («+ Agregar vuelta»); con vuelta, lleva una ✕ para sacarla.
 * - Cada fecha abre «1. El día» (tira de 7 días) y «2. La salida» (tarjetas con hora y lugares libres).
 * - Con la ida elegida se pasa sola a la vuelta, y se anuncia: «✓ Ida lista» y «Ahora, la vuelta».
 *
 * La barra no guarda el viaje: lo tiene el formulario, que es el que lo manda al servidor.
 */

export type ClaveTramo = "ida" | "vuelta";

export type TramoDelViaje = {
  clave: ClaveTramo;
  desde: string;
  hacia: string;
  dia: string;
  /** Primer día que se puede elegir: hoy para la ida, el día de la ida para la vuelta. */
  minimo: string;
  /** Todas las salidas del tramo (de todos los días). */
  salidas: SalidaOption[];
  elegida: string;
};

type Campo = "desde" | "hacia" | ClaveTramo;

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DIAS_LARGOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function aFecha(dia: string) {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function sumarDias(dia: string, dias: number) {
  const fecha = aFecha(dia);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** «jue 19 nov». */
export function diaCorto(dia: string) {
  if (!dia) return "";
  const fecha = aFecha(dia);
  return `${DIAS[fecha.getUTCDay()]} ${fecha.getUTCDate()} ${MESES[fecha.getUTCMonth()]}`;
}

function diaLargo(dia: string) {
  const fecha = aFecha(dia);
  return `${DIAS_LARGOS[fecha.getUTCDay()]} ${fecha.getUTCDate()}/${String(fecha.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function hoyEnArgentina() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Salta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
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

function IconoCombi() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="12" rx="2.5" />
      <path d="M3 11h18M8 5v6M14 5v6" />
      <circle cx="7.5" cy="18.5" r="1.5" />
      <circle cx="16.5" cy="18.5" r="1.5" />
    </svg>
  );
}

export function ViajeSearchBar({
  origenes, destinos, origen, destino, puedeInvertir, tramos, ofrecerVuelta,
  rutaSinSalidas, onLugar, onInvertir, onDia, onSalida, onAgregarVuelta, onQuitarVuelta
}: {
  origenes: Lugar[];
  /** Los destinos del origen elegido. */
  destinos: Lugar[];
  origen: string;
  destino: string;
  /** Hay salidas en el otro sentido (de `destino` a `origen`). */
  puedeInvertir: boolean;
  /** La ida, y la vuelta si se agregó. */
  tramos: TramoDelViaje[];
  /** Con un tramo y vuelta posible: lo que dice el casillero apagado. */
  ofrecerVuelta: { detalle: string } | null;
  /** La ruta elegida existe pero todavía no tiene salidas cargadas: se ofrece ir a cargarlas. */
  rutaSinSalidas?: { id: string } | null;
  onLugar: (campo: "desde" | "hacia", nombre: string) => void;
  onInvertir: () => void;
  onDia: (tramo: ClaveTramo, dia: string) => void;
  onSalida: (tramo: ClaveTramo, id: string) => void;
  onAgregarVuelta: () => void;
  onQuitarVuelta: () => void;
}) {
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [abierto, setAbierto] = useState<Campo | null>(null);
  const [inicioTira, setInicioTira] = useState<Partial<Record<ClaveTramo, string>>>({});
  /** El tramo al que se acaba de pasar solo: mientras siga abierto, el panel lo anuncia. */
  const [recienPaso, setRecienPaso] = useState<ClaveTramo | null>(null);
  const hoy = hoyEnArgentina();

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

  // Al abrir un panel, el foco va a lo elegido (o a lo primero), para seguir con el teclado.
  useEffect(() => {
    if (!abierto) return;
    const panel = raiz.current?.querySelector<HTMLElement>(".trip-search-panel");
    const destinoFoco = panel?.querySelector<HTMLElement>("[aria-pressed='true'], [aria-checked='true']") ??
      panel?.querySelector<HTMLElement>("button:not([disabled])");
    destinoFoco?.focus({ preventScroll: true });
  }, [abierto]);

  // Al pasar sola a la vuelta, la pantalla se acomoda para que se vea el casillero y el anuncio.
  useEffect(() => {
    if (!recienPaso) return;
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    raiz.current?.querySelector<HTMLElement>(`[data-campo="${recienPaso}"]`)
      ?.scrollIntoView({ behavior: suave ? "smooth" : "auto", block: "start" });
  }, [recienPaso]);

  function alternar(campo: Campo) {
    setRecienPaso(null);
    setAbierto((actual) => (actual === campo ? null : campo));
  }

  function elegirLugar(campo: "desde" | "hacia", nombre: string) {
    onLugar(campo, nombre);
    // Como en el aeropuerto: de «Desde» a «Hacia», y de «Hacia» al día de la ida.
    setRecienPaso(null);
    setAbierto(campo === "desde" ? "hacia" : "ida");
  }

  function elegirSalida(tramo: TramoDelViaje, salidaId: string) {
    onSalida(tramo.clave, salidaId);
    const vuelta = tramos.find((t) => t.clave === "vuelta");
    const siguiente = tramo.clave === "ida" && vuelta && !vuelta.elegida ? "vuelta" : null;
    setAbierto(siguiente);
    setRecienPaso(siguiente);
  }

  function agregarVuelta() {
    onAgregarVuelta();
    // Con la ida ya elegida, se anuncia el paso; si no, se abre la vuelta para mirar sus días.
    const ida = tramos.find((t) => t.clave === "ida");
    setAbierto("vuelta");
    setRecienPaso(ida?.elegida ? "vuelta" : null);
  }

  function quitarVuelta() {
    onQuitarVuelta();
    setAbierto((actual) => (actual === "vuelta" ? null : actual));
    setRecienPaso(null);
  }

  const panelId = `${id}-panel`;
  const tramoAbierto = tramos.find((tramo) => tramo.clave === abierto) ?? null;

  function campoLugar(campo: "desde" | "hacia") {
    const nombre = campo === "desde" ? origen : destino;
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
          <IconoPin />
          {nombre || (campo === "desde" ? "Elegí el origen" : "Elegí el destino")}
        </span>
      </button>
    );
  }

  function campoTramo(tramo: TramoDelViaje) {
    const salida = tramo.salidas.find((item) => item.id === tramo.elegida) ?? null;
    const conCruz = tramo.clave === "vuelta";
    return (
      <div key={tramo.clave} className="trip-search-leg-slot">
        <button
          type="button"
          className="trip-search-field trip-search-leg"
          data-con-cruz={conCruz ? "true" : undefined}
          data-campo={tramo.clave}
          data-abierto={abierto === tramo.clave || undefined}
          data-listo={Boolean(salida) || undefined}
          data-siguiente={(recienPaso === tramo.clave && abierto === tramo.clave) || undefined}
          aria-expanded={abierto === tramo.clave}
          aria-controls={panelId}
          onClick={() => alternar(tramo.clave)}
        >
          <span className="trip-search-label">{tramo.clave === "ida" ? "Ida" : "Vuelta"}</span>
          <span className="trip-search-value">
            {salida ? <span className="viaje-combi" aria-hidden="true"><IconoCombi /></span> : <IconoCalendario />}
            <span>
              {diaCorto(tramo.dia)}
              {salida
                ? <b><span className="trip-search-sep"> · </span>{salida.timeLabel}</b>
                : <em><span className="trip-search-sep"> · </span>elegir salida</em>}
            </span>
          </span>
        </button>
        {conCruz ? (
          <button type="button" className="trip-search-remove" aria-label="Sacar la vuelta y reservar sólo la ida" title="Sacar la vuelta" onClick={quitarVuelta}>
            <span aria-hidden="true">✕</span>
          </button>
        ) : null}
      </div>
    );
  }

  function campoAgregarVuelta(oferta: { detalle: string }) {
    return (
      <button type="button" className="trip-search-field trip-search-leg trip-search-add" data-vacio="true" data-campo="agregar-vuelta" onClick={agregarVuelta}>
        <span className="trip-search-label">Vuelta</span>
        <span className="trip-search-value">
          <span className="trip-search-add-icon" aria-hidden="true">+</span>
          <span>Agregar vuelta</span>
        </span>
        <small className="trip-search-add-detail">{oferta.detalle}</small>
      </button>
    );
  }

  function panelLugar(campo: "desde" | "hacia") {
    const lista = campo === "desde" ? origenes : destinos;
    const actual = campo === "desde" ? origen : destino;
    return (
      <>
        <p className="trip-search-panel-title">{campo === "desde" ? "¿Desde dónde sale?" : "¿Adónde va?"}</p>
        <div className="trip-search-places" role="radiogroup" aria-label={campo === "desde" ? "Desde" : "Hacia"}>
          {lista.map((lugar) => (
            <button
              key={lugar.nombre}
              type="button"
              role="radio"
              aria-checked={actual === lugar.nombre}
              className="trip-search-option"
              onClick={() => elegirLugar(campo, lugar.nombre)}
            >
              <span className="trip-search-option-icon"><IconoPin /></span>
              <span className="trip-search-option-text">
                <b>{lugar.nombre}</b>
                <small>{lugar.salidas ? `${lugar.salidas} ${lugar.salidas === 1 ? "salida" : "salidas"} con lugar` : "Sin salidas cargadas"}</small>
              </span>
              {actual === lugar.nombre ? <span className="trip-search-tick" aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
      </>
    );
  }

  function panelTramo(tramo: TramoDelViaje) {
    const minimo = tramo.minimo || hoy;
    const pedido = inicioTira[tramo.clave] ?? (tramo.dia && tramo.dia >= minimo ? tramo.dia : minimo);
    const inicio = pedido < minimo ? minimo : pedido;
    const mover = (desdeDia: string) => setInicioTira((actual) => ({ ...actual, [tramo.clave]: desdeDia }));
    const delTramo = tramo.salidas.filter((salida) => salida.dayKey >= minimo);
    const conteo = conteoPorDia(delTramo);
    // Sólo los días que tienen servicio (19-nov): antes se mostraban siete días de calendario y los
    // que no tenían salidas quedaban apagados. El día elegido siempre queda a la vista.
    const conServicio = diasConSalidas(delTramo).map((dia) => dia.key);
    const tira = tiraConServicio(conServicio, inicio);
    const dias = tramo.dia && conServicio.includes(tramo.dia) && !tira.dias.includes(tramo.dia)
      ? [tramo.dia, ...tira.dias].slice(0, 7)
      : tira.dias;
    const delDia = tramo.salidas.filter((salida) => salida.dayKey === tramo.dia && salida.dayKey >= minimo);
    const proximo = tramo.salidas.find((salida) => salida.dayKey > tramo.dia && salida.dayKey >= minimo);
    const ida = tramos.find((t) => t.clave === "ida");
    const salidaIda = ida?.salidas.find((salida) => salida.id === ida.elegida) ?? null;
    const recienLlegado = tramo.clave === "vuelta" && recienPaso === "vuelta" && salidaIda;

    return (
      <>
        {recienLlegado ? (
          <div className="trip-search-handoff" role="status">
            <span className="trip-search-handoff-check" aria-hidden="true">✓</span>
            <span className="trip-search-handoff-text">
              <b>Ida lista</b>
              <span>{diaCorto(salidaIda.dayKey)} · {salidaIda.timeLabel} · {salidaIda.from} → {salidaIda.to}</span>
            </span>
          </div>
        ) : null}
        {tramos.length > 1 ? (
          <p className="trip-search-panel-kicker">
            {recienLlegado ? "Ahora, la vuelta" : `Tramo ${tramo.clave === "ida" ? 1 : 2} de 2 · ${tramo.clave === "ida" ? "Ida" : "Vuelta"}`}
          </p>
        ) : null}
        <p className="trip-search-panel-title">{tramo.desde} → {tramo.hacia}</p>
        <p className="trip-search-panel-help">
          {tramo.clave === "ida" ? "¿Qué día viaja y en qué salida?" : "¿Qué día vuelve? Sólo se ofrecen las salidas posteriores a la ida."}
        </p>

        <p className="trip-search-step">1. El día</p>
        <div className="trip-search-days">
          <button type="button" className="trip-search-arrow" aria-label="Días anteriores" disabled={!tira.hayAntes}
            onClick={() => mover(conServicio[Math.max(0, tira.base - 7)] ?? inicio)}>‹<span className="trip-search-arrow-text"> Días anteriores</span></button>
          <div className="trip-search-day-list">
            {dias.map((dia) => {
              const fecha = aFecha(dia);
              const cantidad = conteo.get(dia) ?? 0;
              return (
                <button
                  key={dia}
                  type="button"
                  className="trip-search-day viaje-dia"
                  aria-pressed={dia === tramo.dia}
                  disabled={cantidad === 0}
                  aria-label={`${diaLargo(dia)}${dia === hoy ? ", hoy" : ""} · ${cantidad ? `${cantidad} ${cantidad === 1 ? "salida" : "salidas"}` : "sin salidas"}`}
                  onClick={() => { if (dia !== tramo.dia) onDia(tramo.clave, dia); }}
                >
                  <small>{dia === hoy ? "hoy" : DIAS[fecha.getUTCDay()]}</small>
                  <b>{fecha.getUTCDate()}</b>
                  <small>{cantidad ? `${cantidad} ${cantidad === 1 ? "salida" : "salidas"}` : MESES[fecha.getUTCMonth()]}</small>
                </button>
              );
            })}
          </div>
          <button type="button" className="trip-search-arrow" aria-label="Días siguientes" disabled={!tira.hayDespues}
            onClick={() => mover(conServicio[Math.min(conServicio.length - 1, tira.base + 7)] ?? inicio)}><span className="trip-search-arrow-text">Días siguientes </span>›</button>
        </div>

        <p className="trip-search-step">2. La salida del {tramo.dia ? diaLargo(tramo.dia) : "día"}</p>
        {tramo.salidas.length === 0 ? (
          <p className="trip-search-empty">
            Esta ruta todavía no tiene salidas cargadas con lugar.{" "}
            {tramo.clave === "ida" && rutaSinSalidas ? (
              <a className="viaje-proximo" href={`/admin/rutas/${rutaSinSalidas.id}/salidas/nueva`}>Cargar salidas de {tramo.desde} → {tramo.hacia} ›</a>
            ) : null}
          </p>
        ) : delDia.length === 0 ? (
          <p className="trip-search-empty">
            No hay salidas con lugar ese día.{" "}
            {proximo ? (
              <button type="button" className="viaje-proximo" onClick={() => { mover(proximo.dayKey); onDia(tramo.clave, proximo.dayKey); }}>
                Ir al {diaCorto(proximo.dayKey)}, el próximo con salidas ›
              </button>
            ) : "Probá con otro destino."}
          </p>
        ) : (
          <div className="trip-search-flights">
            {delDia.map((salida) => {
              const elegida = salida.id === tramo.elegida;
              return (
                <button
                  key={salida.id}
                  type="button"
                  className="trip-search-flight"
                  aria-pressed={elegida}
                  onClick={() => elegirSalida(tramo, salida.id)}
                >
                  <b className="trip-search-flight-time">{salida.timeLabel}</b>
                  <span className="viaje-combi viaje-combi-grande" aria-hidden="true"><IconoCombi /></span>
                  <span className="trip-search-flight-text">
                    <b>{salida.from} → {salida.to}</b>
                    <small>{salida.status === "DOCUMENTATION" ? "En documentación" : salida.stopFares?.length ? `Con ${salida.stopFares.length === 1 ? "una parada" : `${salida.stopFares.length} paradas`} en el camino` : "Directo"}</small>
                  </span>
                  <span className="trip-search-flight-seats">
                    {elegida ? "✓ Elegida" : `${salida.availableSeats} ${salida.availableSeats === 1 ? "libre" : "libres"}`}
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
    <div className="trip-search viaje-search" ref={raiz}>
      <div className="trip-search-bar" data-tramos={tramos.length}>
        <div className="trip-search-places-row">
          {campoLugar("desde")}
          <button
            type="button"
            className="trip-search-swap"
            aria-label="Invertir: cambiar desde y hacia"
            title={puedeInvertir ? "Invertir" : "No hay salidas en el otro sentido"}
            disabled={!puedeInvertir}
            onClick={() => { setAbierto(null); setRecienPaso(null); onInvertir(); }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 8h11" /><path d="m14 5 3 3-3 3" /><path d="M18 16H7" /><path d="m10 13-3 3 3 3" />
            </svg>
          </button>
          {campoLugar("hacia")}
        </div>
        {/* Siempre dos fechas, mitad y mitad: la ida y la vuelta (o la vuelta para agregar). */}
        <div className="trip-search-dates">
          {tramos.map(campoTramo)}
          {tramos.length === 1 && ofrecerVuelta ? campoAgregarVuelta(ofrecerVuelta) : null}
        </div>
      </div>

      {abierto ? (
        <div
          key={abierto}
          className="trip-search-panel"
          id={panelId}
          role="group"
          data-paso={recienPaso && abierto === recienPaso ? "siguiente" : undefined}
          aria-label={tramoAbierto ? (tramoAbierto.clave === "ida" ? "Ida" : "Vuelta") : abierto === "desde" ? "Desde" : "Hacia"}
        >
          <button type="button" className="trip-search-close" aria-label="Cerrar" onClick={() => setAbierto(null)}>✕</button>
          {abierto === "desde" || abierto === "hacia" ? panelLugar(abierto) : tramoAbierto ? panelTramo(tramoAbierto) : null}
        </div>
      ) : null}
    </div>
  );
}
