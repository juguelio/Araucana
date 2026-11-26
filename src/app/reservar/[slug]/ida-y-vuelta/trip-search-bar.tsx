"use client";

import { useContext, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { PrivateAirportChoiceContext } from "../private-airport-context";
import { avisoItinerario } from "@/lib/airport/data-quality";
import { tramoDeVuelo } from "@/lib/airport/airports";
import { airlineName } from "@/lib/airport/airlines";
import { AirlineBadge } from "@/components/airline-badge";

/**
 * Barra de búsqueda al estilo de los buscadores de vuelos (pedido de Jugue, 17-nov: «como en Kiwi»,
 * pensado para alguien de 70 años). Cuatro campos grandes —Desde, Hacia, Ida y Vuelta— y cada uno
 * abre debajo su propio panel: los lugares, o los días y los vuelos. Todo se elige tocando; no hay
 * que escribir nada.
 *
 * Sirve para **uno o dos tramos**: el ida y vuelta usa dos y la reserva de un solo tramo usa uno
 * (ahí el paso anterior —las tres tarjetas— ya eligió el sentido). Con un tramo:
 * - no se muestran el botón «Invertir» ni el panel «¿Invertir el viaje?» (no hay orden que invertir);
 * - Desde/Hacia se ven pero **no se tocan**: el sentido lo fijó la tarjeta del paso 1 y permitir
 *   cambiarlo acá dejaría el formulario elegido por un lado y el vuelo por otro. Para cambiarlo se
 *   vuelve al paso 1.
 */

export type Sentido = "ARRIVAL" | "DEPARTURE";
export type Orden = Sentido;

export type VueloOpcion = {
  id: string;
  number: string;
  airline: string | null;
  origin?: string | null;
  source?: string;
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

/**
 * Las dos puntas del viaje se listan en Desde y en Hacia, pero **nunca el mismo lugar en las dos**:
 * con San Martín elegido como salida, «¿Adónde va?» ofrecía «San Martín de los Andes» (un viaje de
 * un lugar a sí mismo). Se ofrece el otro extremo y nada más (20-nov).
 */
export function lugaresDelPanel(otro: Lugar): Lugar[] {
  return (["CPC", "SMA"] as const).filter((lugar) => lugar !== otro);
}

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

/**
 * Un lugar de otro servicio en Desde/Hacia (pantalla única de «Reservar», 19-nov): Villa Traful,
 * Villa La Angostura… Elegirlo lleva al alta por salida de ese recorrido, en la misma pantalla.
 */
export type LugarDeOtroServicio = { nombre: string; detalle: string; href: string; scroll?: boolean };

export function TripSearchBar({
  orden, tramos, routeSlug, confirmarCambio = false,
  onPedirOrden, onConfirmarCambio, onCancelarCambio, onFecha, onVuelo, agregarVuelta, quitarVueltaHref, lugaresExtra,
  onAbrirVuelos, privatePlace, locale = "es", abrirLaVuelta = false
}: {
  /** El sentido del viaje: define Desde/Hacia. Sin esto (un solo tramo) sale del único tramo. */
  orden?: Orden;
  /** Los tramos en el orden del viaje: uno (reserva simple) o dos (ida y vuelta). */
  tramos: TramoDeLaBarra[];
  routeSlug: string;
  privatePlace?: string;
  locale?: "es" | "en" | "pt";
  /** Pedir un orden: si cambia y ya hay vuelos elegidos, el formulario pregunta antes. */
  onPedirOrden?: (orden: Orden) => void;
  /** Pregunta «¿Invertir el viaje?» abierta: sólo existe con dos tramos. */
  confirmarCambio?: boolean;
  onConfirmarCambio?: () => void;
  onCancelarCambio?: () => void;
  onAbrirVuelos?: () => void;
  onFecha: (sentido: Sentido, fecha: string) => void;
  onVuelo: (sentido: Sentido, id: string) => void;
  /**
   * Un tramo: el segundo casillero de fecha es la vuelta, apagada. Tocarlo lleva al ida y vuelta con lo
   * ya elegido (pedido de Jugue, 18-nov: «que los selectores de fecha siempre sean dos»).
   */
  agregarVuelta?: { href: string; detalle?: string };
  /** Ida y vuelta: la cruz arriba a la derecha de la vuelta la saca y lleva a la reserva de un tramo. */
  quitarVueltaHref?: string;
  /**
   * Panel: los lugares de las rutas por salida, para reservar todo desde la misma pantalla (19-nov:
   * «que eso esté ya en el nombre de los lugares… cuando haya más rutas va a estar muy cluttered»).
   * `desde` se ofrece siempre; `hacia`, cuando sale de San Martín.
   */
  lugaresExtra?: { desde: LugarDeOtroServicio[]; hacia: LugarDeOtroServicio[] };
  /**
   * Se llegó desde «Agregar vuelta» (`?abrir=vuelta`): el segundo tramo abre su panel solo.
   * Antes el primer toque sólo agregaba la vuelta y había que tocar de nuevo para ver los vuelos
   * (pedido de Jugue, 20-nov).
   */
  abrirLaVuelta?: boolean;
}) {
  const t = (es: string, en: string, pt: string) => locale === "en" ? en : locale === "pt" ? pt : es;
  const id = useId();
  const privateChoice = useContext(PrivateAirportChoiceContext);
  const raiz = useRef<HTMLDivElement>(null);
  const [abierto, setAbierto] = useState<Campo | null>(abrirLaVuelta && tramos.length > 1 ? tramos[1].sentido : null);
  /** El primer día de la tira de cada tramo: se corre de a una semana con las flechas. */
  const [inicioTira, setInicioTira] = useState<Partial<Record<Sentido, string>>>({});
  /**
   * El tramo al que se acaba de pasar solo (con la ida elegida se abre la vuelta). Mientras siga abierto,
   * el panel lo anuncia bien a la vista (pedido de Jugue, 18-nov: «la transición tiene que ser mucho más notable»).
   */
  const [recienPaso, setRecienPaso] = useState<Sentido | null>(
    abrirLaVuelta && tramos.length > 1 ? tramos[1].sentido : null
  );

  // Llegada desde «Agregar vuelta»: se baja hasta la vuelta para que el panel entre a la vista.
  useEffect(() => {
    if (!abrirLaVuelta) return;
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    raiz.current?.querySelector<HTMLElement>("[data-abierto]")
      ?.scrollIntoView({ behavior: suave ? "smooth" : "auto", block: "center" });
  }, [abrirLaVuelta]);

  // Con un solo tramo el sentido es el del tramo; con dos manda el orden del viaje.
  const sentidoBase: Sentido = orden ?? tramos[0]?.sentido ?? "ARRIVAL";
  const desde: Lugar = sentidoBase === "ARRIVAL" ? "CPC" : "SMA";
  const hacia: Lugar = sentidoBase === "ARRIVAL" ? "SMA" : "CPC";
  /**
   * Desde/Hacia se editan si el formulario deja cambiar el sentido (`onPedirOrden`). Desde el 18-nov
   * la reserva de un tramo también: es el mismo recuadro que el ida y vuelta, con las mismas flechas.
   */
  const lugares = privatePlace ? { ...LUGARES, SMA: { nombre: privatePlace, detalle: "Paradas del traslado privado" } } : LUGARES;
  const lugaresFijos = !onPedirOrden && !lugaresExtra;

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

  // Al pasar solo a la vuelta, la pantalla se acomoda: el casillero de la vuelta arriba y el panel debajo,
  // con el anuncio a la vista (en el celular quedaba tapado por el encabezado del sitio).
  useEffect(() => {
    if (!recienPaso) return;
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    raiz.current?.querySelector<HTMLElement>(`[data-campo="${recienPaso}"]`)
      ?.scrollIntoView({ behavior: suave ? "smooth" : "auto", block: "start" });
  }, [recienPaso]);

  function alternar(campo: Campo) {
    if ((campo === "ARRIVAL" || campo === "DEPARTURE") && campo !== abierto) onAbrirVuelos?.();
    if (confirmarCambio) onCancelarCambio?.();
    setRecienPaso(null);
    setAbierto((actual) => (actual === campo ? null : campo));
  }

  function elegirLugar(campo: "desde" | "hacia", lugar: Lugar) {
    const nuevo = ordenPara(campo, lugar);
    if (nuevo !== sentidoBase) onPedirOrden?.(nuevo);
    // Se sigue al campo siguiente, como en Kiwi: de «Desde» a «Hacia», y de «Hacia» al día de ida
    // (el tramo de ida es siempre el del orden elegido). Si hay que confirmar, el panel espera.
    if (campo === "hacia") onAbrirVuelos?.();
    setAbierto(campo === "desde" ? "hacia" : nuevo);
  }

  function elegirVuelo(tramo: TramoDeLaBarra, vueloId: string) {
    onVuelo(tramo.sentido, vueloId);
    // Después de la ida se abre la vuelta, si todavía no tiene vuelo; si no (o si es un solo
    // tramo), se cierra.
    const otro = tramos.find((t) => t.sentido !== tramo.sentido);
    const siguiente = tramo === tramos[0] && otro && !otro.elegido ? otro.sentido : null;
    setAbierto(siguiente);
    setRecienPaso(siguiente);
  }

  const tramoAbierto = tramos.find((tramo) => tramo.sentido === abierto) ?? null;
  const panelId = `${id}-panel`;
  const hoy = hoyEnArgentina();

  function campoLugar(campo: "desde" | "hacia") {
    const lugar = campo === "desde" ? desde : hacia;
    const contenido = (
      <>
        <span className="trip-search-label">{campo === "desde" ? t("Desde", "From", "Origem") : t("Hacia", "To", "Destino")}</span>
        <span className="trip-search-chip">
          {lugar === "CPC" ? <IconoAvion /> : <IconoPin />}
          {lugares[lugar].nombre}
        </span>
      </>
    );
    // Sin `onPedirOrden` el sentido no se puede cambiar acá: el lugar se muestra como dato del viaje.
    if (lugaresFijos) {
      return (
        <div className="trip-search-field trip-search-place" data-campo={campo} data-fijo="true">
          {contenido}
        </div>
      );
    }
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
        {contenido}
      </button>
    );
  }

  function campoTramo(tramo: TramoDeLaBarra, quitarHref?: string) {
    const vuelo = tramo.opciones.find((opcion) => opcion.id === tramo.elegido) ?? null;
    return (
      <div key={tramo.sentido} className="trip-search-leg-slot">
        <button
          type="button"
          className="trip-search-field trip-search-leg"
          data-con-cruz={quitarHref ? "true" : undefined}
          data-campo={tramo.sentido}
          data-abierto={abierto === tramo.sentido || undefined}
          data-listo={Boolean(vuelo) || undefined}
          data-siguiente={(recienPaso === tramo.sentido && abierto === tramo.sentido) || undefined}
          aria-expanded={abierto === tramo.sentido}
          aria-controls={panelId}
          onClick={() => alternar(tramo.sentido)}
        >
          <span className="trip-search-label">{tramo.etapa === "Ida" ? t("Ida", "Outbound", "Ida") : tramo.etapa === "Vuelta" ? t("Vuelta", "Return", "Volta") : tramo.etapa} · {tramo.sentido === "ARRIVAL" ? t("Llegada", "Arrival", "Chegada") : t("Salida", "Departure", "Partida")}</span>
          <span className="trip-search-value">
            {/* Con el vuelo elegido, el logo de la aerolínea dice más que el calendario. */}
            {vuelo ? <AirlineBadge code={vuelo.airline} size={28} /> : <IconoCalendario />}
            <span>
              {diaCorto(tramo.fecha)}
              {/* El « · » se esconde en el celular, donde la hora y el vuelo van en su propio renglón. */}
              {vuelo
                ? <b><span className="trip-search-sep"> · </span>{hora(vuelo.estimatedAt ?? vuelo.scheduledAt)} {vuelo.number}</b>
                : <em><span className="trip-search-sep"> · </span>{t("elegir vuelo", "choose flight", "escolher voo")}</em>}
            </span>
          </span>
        </button>
        {/* La cruz es hermana del botón (no puede ir adentro de otro botón). */}
        {quitarHref ? (
          <Link
            href={quitarHref}
            scroll={false}
            className="trip-search-remove"
            aria-label="Sacar la vuelta y reservar un solo tramo"
            title="Sacar la vuelta"
          >
            <span aria-hidden="true">✕</span>
          </Link>
        ) : null}
      </div>
    );
  }

  /** La vuelta que todavía no está: se ve apagada y se toca para sumarla. */
  function campoAgregarVuelta(oferta: { href: string; detalle?: string }) {
    const otro: Sentido = sentidoBase === "ARRIVAL" ? "DEPARTURE" : "ARRIVAL";
    return (
      <Link href={oferta.href} scroll={false} className="trip-search-field trip-search-leg trip-search-add" data-vacio="true">
        <span className="trip-search-label">{t("Vuelta", "Return", "Volta")} · {otro === "ARRIVAL" ? t("Llegada", "Arrival", "Chegada") : t("Salida", "Departure", "Partida")}</span>
        <span className="trip-search-value">
          <span className="trip-search-add-icon" aria-hidden="true">+</span>
          <span>{t("Agregar vuelta", "Add return", "Adicionar volta")}</span>
        </span>
        {oferta.detalle ? <small className="trip-search-add-detail">{oferta.detalle}</small> : null}
      </Link>
    );
  }

  function panelLugar(campo: "desde" | "hacia") {
    const actual = campo === "desde" ? desde : hacia;
    const otro = campo === "desde" ? hacia : desde;
    const opciones = privatePlace && onPedirOrden ? [actual, otro] : lugaresDelPanel(otro);
    return (
      <>
        <p className="trip-search-panel-title">{campo === "desde" ? t("¿Desde dónde sale?", "Where are you leaving from?", "De onde você sai?") : t("¿Adónde va?", "Where are you going?", "Para onde você vai?")}</p>
        <div className="trip-search-places" role="radiogroup" aria-label={campo === "desde" ? t("Desde", "From", "Origem") : t("Hacia", "To", "Destino")}>
          {opciones.map((lugar) => (
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
                <b>{lugares[lugar].nombre}</b>
                <small>{lugares[lugar].detalle}</small>
              </span>
              {actual === lugar ? <span className="trip-search-tick" aria-hidden="true">✓</span> : null}
            </button>
          ))}
          {/* Los lugares de las rutas por salida: llevan a ese recorrido, en la misma pantalla. */}
          {(campo === "desde" ? lugaresExtra?.desde ?? [] : desde === "SMA" ? lugaresExtra?.hacia ?? [] : []).map((otro) => (
            <Link key={otro.href} href={otro.href} scroll={otro.scroll ?? false} className="trip-search-option" role="radio" aria-checked={false}>
              <span className="trip-search-option-icon"><IconoPin /></span>
              <span className="trip-search-option-text">
                <b>{otro.nombre}</b>
                <small>{otro.detalle}</small>
              </span>
            </Link>
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
    const indice = tramos.indexOf(tramo);
    const previo = indice > 0 ? tramos[indice - 1] : null;
    const vueloPrevio = previo?.opciones.find((opcion) => opcion.id === previo.elegido) ?? null;
    const recienLlegado = recienPaso === tramo.sentido && previo && vueloPrevio;
    return (
      <>
        {/* Con la ida recién elegida, la vuelta se anuncia: lo que ya quedó listo y lo que sigue. */}
        {recienLlegado ? (
          <div className="trip-search-handoff" role="status">
            <span className="trip-search-handoff-check" aria-hidden="true">✓</span>
            <span className="trip-search-handoff-text">
              <b>{previo.etapa} lista</b>
              <span>{diaCorto(previo.fecha)} · {hora(vueloPrevio.estimatedAt ?? vueloPrevio.scheduledAt)} {vueloPrevio.number}</span>
            </span>
          </div>
        ) : null}
        {tramos.length > 1 ? (
          <p className="trip-search-panel-kicker">
            {recienLlegado ? `Ahora, la ${tramo.etapa.toLowerCase()}` : `Tramo ${indice + 1} de ${tramos.length} · ${tramo.etapa}`}
          </p>
        ) : null}
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
            {tramos.length === 1 || privatePlace
              ? "No hay vuelos para reservar ese día. Probá otro día."
              : <>
                  No hay vuelos para reservar ese día. Probá otro día, o si su vuelo no figura, reservá ese tramo solo desde{" "}
                  <Link className="table-link" href={`/reservar/${routeSlug}?date=${tramo.fecha}`}>la reserva de un tramo</Link>.
                </>}
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
                    {vuelo.source === "ITINERARIO" ? <small>{avisoItinerario}</small> : null}
                  </span>
                  <span className="trip-search-flight-seats">
                    {elegido ? "✓ Elegido" : privatePlace ? "Elegir vuelo" : `${vuelo.available} ${vuelo.available === 1 ? "lugar" : "lugares"}`}
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
      <div className="trip-search-bar" data-tramos={tramos.length}>
        <div className="trip-search-places-row">
          {campoLugar("desde")}
          {/* Invertir: con dos tramos cambia el orden del viaje; con uno, pasa de llegada a salida. */}
          {onPedirOrden ? (
            <button
              type="button"
              className="trip-search-swap"
              aria-label="Invertir: cambiar desde y hacia"
              title="Invertir"
              onClick={() => { setAbierto(null); onPedirOrden(sentidoBase === "ARRIVAL" ? "DEPARTURE" : "ARRIVAL"); }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 8h11" /><path d="m14 5 3 3-3 3" /><path d="M18 16H7" /><path d="m10 13-3 3 3 3" />
              </svg>
            </button>
          ) : null}
          {campoLugar("hacia")}
        </div>
        {privateChoice}
        {/* Siempre dos fechas, mitad y mitad: ida y vuelta, o la ida y la vuelta para agregar. */}
        <div className="trip-search-dates">
          {tramos.map((tramo, indice) => campoTramo(tramo, indice === 1 ? quitarVueltaHref : undefined))}
          {tramos.length === 1 && agregarVuelta ? campoAgregarVuelta(agregarVuelta) : null}
        </div>
      </div>

      {confirmarCambio && onConfirmarCambio && onCancelarCambio ? (
        <div className="trip-search-confirm" role="alert">
          <p><strong>¿Invertir el viaje?</strong> Los vuelos que ya eligió se borran y hay que elegirlos de nuevo.</p>
          <div className="trip-search-confirm-actions">
            <button type="button" className="button" onClick={() => { onConfirmarCambio(); setAbierto(null); }}>Sí, invertir</button>
            <button type="button" className="ghost-button" onClick={onCancelarCambio}>No, dejarlo así</button>
          </div>
        </div>
      ) : null}

      {abierto && !confirmarCambio ? (
        <div
          // La clave cambia con el campo: al pasar de la ida a la vuelta el panel vuelve a entrar, con su animación.
          key={abierto}
          className="trip-search-panel"
          id={panelId}
          role="group"
          data-paso={recienPaso && abierto === recienPaso ? "siguiente" : undefined}
          aria-label={tramoAbierto ? tramoAbierto.titulo : abierto === "desde" ? t("Desde", "From", "Origem") : t("Hacia", "To", "Destino")}
        >
          <button type="button" className="trip-search-close" aria-label="Cerrar" onClick={() => setAbierto(null)}>✕</button>
          {abierto === "desde" || abierto === "hacia" ? panelLugar(abierto) : tramoAbierto ? panelTramo(tramoAbierto) : null}
        </div>
      ) : null}
    </div>
  );
}
