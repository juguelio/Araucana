"use client";

import { avisoItinerario } from "@/lib/airport/data-quality";
import { tramoDeVuelo } from "@/lib/airport/airports";
import { PrivateAirportContext } from "../private-airport-context";
import { separarVuelosDelSelector } from "@/lib/airport/flight-selector";
import { useContext, useEffect, useRef, useState, type FormEvent } from "react";
import { hrefConViaje } from "../airport-trip-options";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { orderedRoundTrip, roundTripOrderValid, roundTripQuote } from "@/lib/airport/round-trip-summary";
import { nuevaClaveDeIdempotencia } from "@/lib/booking/idempotency";
import { AirportPlaceSearch, type AirportSelectedPlace } from "@/components/airport-place-search";
import { googlePickupConfigured } from "@/lib/airport/google-maps";
import type { AirportOfficePickup } from "@/lib/airport/office-pickup";
import { isInsideAirportPickupZone, OUTSIDE_PICKUP_ZONE, type AirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import { airportPickupDateTime } from "@/lib/airport/pickup-start";
import type { PickupPrecision } from "@/lib/airport/place-suggestions";
import { MapPointAddress } from "@/components/map-point-address";
import { isPaihuen, paihuenPickupTime } from "@/lib/airport/paihuen";
import { AirportDraggableMap } from "@/components/airport-draggable-map";
import { TripSearchBar, type TramoDeLaBarra, type LugarDeOtroServicio } from "./trip-search-bar";
import {
  buildPassengerPayload,
  initialPassenger,
  PassengerFields,
  QuantityPicker,
  validateCheckoutPassenger,
  type PassengerFieldErrors,
  type PassengerForm
} from "../passenger-fields";

/**
 * Checkout de ida y vuelta del aeropuerto (#36): **los dos vuelos, los dos pickups y los datos del
 * pasajero una sola vez**. Crea dos reservas enlazadas (`roundTripId`), cada una con su pago, así
 * que cada tramo se puede abonar y cancelar por separado.
 */

type FlightOption = {
  id: string;
  number: string;
  direction: "ARRIVAL" | "DEPARTURE";
  airline: string | null;
  origin?: string | null;
  scheduledAt: string;
  estimatedAt: string | null;
  pickupStartAt?: string | null;
  pickupStartCoordinated?: boolean;
  status: string;
  source?: string;
  available: number;
  bookable: boolean;
  privateBookable?: boolean;
  reason: string | null;
};

type Fare = { priceCents: number; currency: string } | null;

function inicioDeRecorrida(vuelo: FlightOption) {
  if (!vuelo.pickupStartAt) return null;
  const inicio = new Date(vuelo.pickupStartAt);
  return Number.isFinite(inicio.getTime()) ? inicio : null;
}

type RoundTripCheckoutFormProps = {
  route: { slug: string; from: string; to: string; priceCents: number; currency: string };
  fares: Record<"ARRIVAL" | "DEPARTURE", Fare>;
  initialDate: string;
  initialFlights: FlightOption[];
  coverage: AirportCoverage;
  /** Precio por bulto de equipaje deportivo (esquí, snowboard, bici), vigente al reservar. */
  extras: { sportsLuggageCents: number; zoneExtraCents: number };
  /** Atajo «salir desde la sucursal» (#34): sólo llega si está activo y con punto. */
  officePickup?: (AirportOfficePickup & { point: [number, number] }) | null;
  /** A dónde llevan las tarjetas «Llegada» y «Salida»: la reserva de un tramo, con ese sentido elegido. */
  singleHrefs?: { ARRIVAL: string; DEPARTURE: string };
  /** Al venir de la reserva de un tramo («¿Ida y vuelta?»): el sentido y el vuelo ya elegidos. */
  initialOrder?: "ARRIVAL" | "DEPARTURE";
  initialFirstFlightId?: string;
  /** Alta desde el panel: identidad opcional, sin freno por IP y vuelve a la reserva del panel. */
  fromAdmin?: boolean;
  /** Panel: los lugares de las rutas por salida en Desde/Hacia (pantalla única de «Reservar»). */
  lugaresExtra?: LugaresExtra;
  locale?: "es" | "en" | "pt";
  /** Se llegó desde «Agregar vuelta»: la vuelta abre sus opciones sola (20-nov). */
  abrirLaVuelta?: boolean;
};

type LugarPickup = {
  label: string;
  point: PickupPoint | null;
  precision: PickupPrecision | null;
  approximate: boolean;
  elegido: boolean;
  /** Cómo se eligió: la ubicación del teléfono no tiene dirección escrita; la sucursal va con su nombre. */
  origen: "busqueda" | "ubicacion" | "sucursal" | "mapa";
};

const lugarVacio: LugarPickup = { label: "", point: null, precision: null, approximate: false, elegido: false, origen: "busqueda" };
type Sentido = "ARRIVAL" | "DEPARTURE";

type TramoCreado = {
  code: string;
  shortCode: string;
  totalCents: number;
  currency: string;
  flightNumber: string | null;
  direction: string | null;
  serviceDate: string | null;
};

// Una sola página que se va abriendo sola: al elegir el último vuelo aparecen los lugares, y al
// elegir el último lugar aparecen los datos del pasajero. Sin «Continuar» en el medio (pedidos de
// Jugue, 17-nov). Arriba queda un indicador de por dónde va.
const ETAPAS = ["Vuelos", "Lugares", "Tus datos"];

/**
 * Las dos patas del viaje. Los sentidos son fijos (la llegada siempre es CPC → SMA, la salida
 * siempre SMA → CPC); el orden elegido decide cuál va primero en el calendario.
 */
// Con los nombres de los lugares, no sólo los códigos: «SMA → CPC» no le dice nada a quien no viaja
// seguido (pedido de Jugue, 17-nov: «para una persona de 70 años»).
const PATA_LLEGADA = { etiqueta: "Llegada", ruta: "CPC → SMA", desde: "Aeropuerto Chapelco", hacia: "San Martín" };
const PATA_SALIDA = { etiqueta: "Salida", ruta: "SMA → CPC", desde: "San Martín", hacia: "Aeropuerto Chapelco" };

function hhmm(iso: string) {
  return new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);
}

function fechaCorta(dia: string) {
  const [anio, mes, d] = dia.split("-");
  return anio && mes && d ? `${d}/${mes}/${anio}` : dia;
}

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

function formatShortCode(code: string) {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** Las opciones de un sentido que hoy se pueden reservar. */
function descripcionVuelo(vuelo: FlightOption) {
  const partes = [vuelo.number, hhmm(vuelo.estimatedAt ?? vuelo.scheduledAt)];
  const tramo = tramoDeVuelo({ direction: vuelo.direction, origin: vuelo.origin });
  if (tramo) partes.push(tramo);
  if (vuelo.source === "ITINERARIO") partes.push(avisoItinerario);
  return partes.join(" · ");
}

type LugaresExtra = { desde: LugarDeOtroServicio[]; hacia: LugarDeOtroServicio[] };

export function RoundTripCheckoutForm({ route, fares, initialDate, initialFlights, coverage, extras, officePickup = null, fromAdmin = false, singleHrefs, initialOrder = "ARRIVAL", initialFirstFlightId, lugaresExtra, locale, abrirLaVuelta = false }: RoundTripCheckoutFormProps) {
  /**
   * Cuál de los dos tramos va primero en el calendario. `ARRIVAL` = llego a San Martín y después
   * me voy (CPC → SMA, SMA → CPC); `DEPARTURE` = me voy y después vuelvo (SMA → CPC, CPC → SMA).
   */
  const privateCheckout = useContext(PrivateAirportContext);
  const flightRequests = useRef({ ARRIVAL: 0, DEPARTURE: 0 });
  const [orden, setOrden] = useState<"ARRIVAL" | "DEPARTURE">(initialOrder);
  // El vuelo que ya traía la reserva de un tramo queda elegido como primer tramo, si sigue en la lista.
  const vueloQueVino = initialFlights.find((vuelo) => vuelo.id === initialFirstFlightId && vuelo.direction === initialOrder)?.id ?? "";
  /** Cambiar el orden borra los vuelos elegidos: si ya hay alguno, primero se pregunta. */
  const [confirmarCambio, setConfirmarCambio] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const router = useRouter();
  const [fechaLlegada, setFechaLlegada] = useState(initialDate);
  const [fechaVuelta, setFechaVuelta] = useState(initialDate);
  const [vuelosLlegada, setVuelosLlegada] = useState<FlightOption[]>(initialFlights);
  const [vuelosVuelta, setVuelosVuelta] = useState<FlightOption[]>(initialFlights);
  const [llegadaId, setLlegadaId] = useState(initialOrder === "ARRIVAL" ? vueloQueVino : "");
  const [vueltaId, setVueltaId] = useState(initialOrder === "DEPARTURE" ? vueloQueVino : "");
  const [cargandoLlegada, setCargandoLlegada] = useState(false);
  const [cargandoVuelta, setCargandoVuelta] = useState(false);

  const [pickupLlegada, setPickupLlegada] = useState<LugarPickup>(lugarVacio);
  const [pickupVuelta, setPickupVuelta] = useState<LugarPickup>(lugarVacio);
  /** «¿La vuelta es en el mismo lugar?»: se contesta con dos botones; hasta entonces se copia el primero. */
  const [respuestaMismo, setRespuestaMismo] = useState<"si" | "no" | null>(null);
  const mismoLugar = respuestaMismo !== "no";
  const lugaresRef = useRef<HTMLElement>(null);
  const datosRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  /** «Usar mi ubicación actual»: qué tarjeta está esperando al GPS y el error de cada una. */
  const [ubicando, setUbicando] = useState<Sentido | null>(null);
  const [errorUbicacion, setErrorUbicacion] = useState<Partial<Record<Sentido, string>>>({});
  const preguntaRef = useRef<HTMLDivElement>(null);

  const [fullFareCount, setFullFareCount] = useState(1);
  const [halfFareCount, setHalfFareCount] = useState(0);
  const [freeFareCount, setFreeFareCount] = useState(0);
  const [sportsLuggageCount, setSportsLuggageCount] = useState(0);
  // Derivación de otra agencia (#109): sólo existe en el alta del panel y vale para los dos tramos.
  const [referredBy, setReferredBy] = useState("");
  const [passenger, setPassenger] = useState<PassengerForm>(initialPassenger);
  const [fieldErrors, setFieldErrors] = useState<PassengerFieldErrors>({});

  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultado, setResultado] = useState<{ id: string; arrival: TramoCreado; departure: TramoCreado } | null>(null);

  /**
   * Clave del intento de alta (#139). Vale para los dos tramos: el viaje se crea de una sola vez y,
   * si la respuesta se pierde, el reintento devuelve esas mismas dos reservas. Se renueva cuando
   * cambia el orden o alguno de los vuelos, porque eso ya es otro viaje.
   */
  const claveDeIdempotencia = useRef("");
  useEffect(() => {
    claveDeIdempotencia.current = "";
  }, [orden, llegadaId, vueltaId, fechaLlegada, fechaVuelta]);

  const opcionesLlegada = separarVuelosDelSelector(vuelosLlegada, "ARRIVAL", Boolean(privateCheckout)).reservables;
  const opcionesVuelta = separarVuelosDelSelector(vuelosVuelta, "DEPARTURE", Boolean(privateCheckout)).reservables;
  const llegada = opcionesLlegada.find(vuelo => vuelo.id === llegadaId) ?? null;
  const vuelta = opcionesVuelta.find(vuelo => vuelo.id === vueltaId) ?? null;
  /**
   * Los dos tramos en el orden que eligió el pasajero. El segundo lleva `minimo` con la fecha del
   * primero: el que va después no puede ser anterior en el calendario.
   */

  /**
   * La vuelta nunca queda antes que la ida: si al invertir o al mover el día de ida la vuelta queda
   * atrás, se corre al mismo día de la ida y se buscan sus vuelos (antes mostraba una fecha imposible).
   */
  useEffect(() => {
    const [fechaIda, fechaSegunda, sentidoSegundo] = orden === "ARRIVAL"
      ? [fechaLlegada, fechaVuelta, "DEPARTURE" as const]
      : [fechaVuelta, fechaLlegada, "ARRIVAL" as const];
    if (!fechaIda || !fechaSegunda || fechaSegunda >= fechaIda) return;
    if (sentidoSegundo === "DEPARTURE") { setFechaVuelta(fechaIda); setVueltaId(""); }
    else { setFechaLlegada(fechaIda); setLlegadaId(""); }
    void cargarVuelos(fechaIda, sentidoSegundo);
    // cargarVuelos sólo usa setters y el slug: no hace falta en las dependencias.
  }, [orden, fechaLlegada, fechaVuelta]);

  /** Invierte el orden y limpia los vuelos ya elegidos. */
  function cambiarOrden() {
    setOrden(orden === "ARRIVAL" ? "DEPARTURE" : "ARRIVAL");
    setLlegadaId("");
    setVueltaId("");
    setError("");
    setConfirmarCambio(false);
  }

  /** Desde/Hacia o el botón de invertir: si ya hay vuelos elegidos, primero pregunta. */
  function pedirOrden(nuevo: "ARRIVAL" | "DEPARTURE") {
    if (nuevo === orden) return;
    if (llegadaId || vueltaId) setConfirmarCambio(true);
    else cambiarOrden();
  }
  const fraseOrden = orden === "ARRIVAL" ? "Primero llega y después se va" : "Primero se va y después vuelve";

  const bloqueLlegada = {
    sentido: "ARRIVAL" as const,
    titulo: "Llegada a Chapelco",
    ayuda: "El vuelo en el que aterrizás.",
    pregunta: "¿Qué día aterriza en Chapelco y en qué vuelo?",
    fecha: fechaLlegada,
    opciones: opcionesLlegada,
    elegido: llegadaId,
    setElegido: setLlegadaId,
    cargando: cargandoLlegada
  };
  const bloqueSalida = {
    sentido: "DEPARTURE" as const,
    titulo: privateCheckout ? "Salida desde Chapelco" : "Salida desde San Martín",
    ayuda: "El vuelo con el que te vas.",
    pregunta: "¿Qué día se va y en qué vuelo? Lo buscamos antes para llegar a tiempo.",
    fecha: fechaVuelta,
    opciones: opcionesVuelta,
    elegido: vueltaId,
    setElegido: setVueltaId,
    cargando: cargandoVuelta
  };
  const bloquesDelViaje = orden === "ARRIVAL"
    ? [
        { ...bloqueLlegada, etapa: "1º tramo (ida)", minimo: "" },
        { ...bloqueSalida, etapa: "2º tramo (vuelta)", minimo: fechaLlegada }
      ]
    : [
        { ...bloqueSalida, etapa: "1º tramo (ida)", minimo: "" },
        { ...bloqueLlegada, etapa: "2º tramo (vuelta)", minimo: fechaVuelta }
      ];

  const passengerCount = fullFareCount + halfFareCount + freeFareCount;

  /**
   * El primer tramo del viaje manda el lugar; el segundo lo copia cuando el pasajero lo pide (caso
   * normal). Con «primero me voy» el ancla es la salida, no la llegada: si no, el bloque habilitado
   * escribía en el tramo que no correspondía.
   */
  const tramoAncla = orden;
  useEffect(() => {
    if (!mismoLugar) return;
    if (tramoAncla === "ARRIVAL") setPickupVuelta(pickupLlegada);
    else setPickupLlegada(pickupVuelta);
  }, [mismoLugar, tramoAncla, pickupLlegada, pickupVuelta]);

  const pickupLlegadaListo = Boolean(pickupLlegada.elegido) && Boolean(pickupLlegada.point);
  const pickupVueltaListo = Boolean(pickupVuelta.elegido) && Boolean(pickupVuelta.point);
  /** Los lugares siguen el orden del viaje: el primero manda y el segundo lo copia o se elige aparte. */
  const segundoSentido = orden === "ARRIVAL" ? ("DEPARTURE" as const) : ("ARRIVAL" as const);
  const lugarAncla = orden === "ARRIVAL" ? pickupLlegada : pickupVuelta;
  const primerLugarListo = orden === "ARRIVAL" ? pickupLlegadaListo : pickupVueltaListo;
  const lugaresListos = primerLugarListo && respuestaMismo !== null && pickupLlegadaListo && pickupVueltaListo;
  const textosLugar = orden === "ARRIVAL"
    ? {
        titulo: "¿Adónde lo llevamos y dónde lo buscamos?",
        ayuda: "Cuando llega lo dejamos en su alojamiento; para irse lo pasamos a buscar.",
        primero: "¿Adónde lo llevamos cuando llega?",
        pregunta: "Para irse, ¿lo buscamos en el mismo lugar?",
        segundo: "¿Dónde lo buscamos para ir al aeropuerto?"
      }
    : {
        titulo: "¿Dónde lo buscamos y adónde lo llevamos?",
        ayuda: "Para irse lo pasamos a buscar; cuando vuelve lo dejamos en su alojamiento.",
        primero: "¿Dónde lo buscamos para ir al aeropuerto?",
        pregunta: "Cuando vuelve, ¿lo llevamos al mismo lugar?",
        segundo: "¿Adónde lo llevamos cuando vuelve?"
      };

  // Al elegir el último vuelo, la pantalla baja sola a los lugares (y el foco va al título, para el
  // lector de pantalla). Sólo cuando aparecen, no en cada cambio.
  const vuelosListos = Boolean(llegada && vuelta);
  // Una vez que una sección apareció, se queda: si después cambia un vuelo o un lugar, no se le
  // borra de la pantalla lo que ya estaba cargando.
  const [lugaresAbiertos, setLugaresAbiertos] = useState(false);
  const [datosAbiertos, setDatosAbiertos] = useState(false);
  if (vuelosListos && !lugaresAbiertos) setLugaresAbiertos(true);
  if (lugaresListos && !datosAbiertos) setDatosAbiertos(true);
  const vuelosListosAntes = useRef(vuelosListos);
  useEffect(() => {
    if (vuelosListos && !vuelosListosAntes.current) {
      const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // La barra arriba y los lugares justo debajo: no se pierde de vista lo que se eligió (18-nov).
      const barra = lugaresRef.current?.closest("form")?.querySelector<HTMLElement>(".trip-search") ?? lugaresRef.current;
      barra?.scrollIntoView({ behavior: suave ? "smooth" : "auto", block: "start" });
      lugaresRef.current?.querySelector<HTMLElement>("#pickup-flow-titulo")?.focus({ preventScroll: true });
    }
    vuelosListosAntes.current = vuelosListos;
  }, [vuelosListos]);
  // Y con los datos del pasajero, cuando queda elegido el último lugar.
  const lugaresListosAntes = useRef(lugaresListos);
  useEffect(() => {
    if (lugaresListos && !lugaresListosAntes.current) {
      const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      datosRef.current?.scrollIntoView({ behavior: suave ? "smooth" : "auto", block: "start" });
      datosRef.current?.querySelector<HTMLElement>("#datos-titulo")?.focus({ preventScroll: true });
    }
    lugaresListosAntes.current = lugaresListos;
  }, [lugaresListos]);
  // Lo mismo con la pregunta del mismo lugar: aparece y queda a la vista.
  useEffect(() => {
    if (primerLugarListo && respuestaMismo === null) preguntaRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [primerLugarListo, respuestaMismo]);

  /** Una tarjeta de lugar: atajo de la sucursal, buscador, dirección elegida y mapa con el pin. */
  function tarjetaLugar(sentido: "ARRIVAL" | "DEPARTURE", titulo: string, numero: number, deshabilitado: boolean) {
    const lugar = sentido === "ARRIVAL" ? pickupLlegada : pickupVuelta;
    function markPoint(point: PickupPoint) {
      ponerLugar(sentido, { ...lugarVacio, point, origen: "mapa" });
    }
    return (
      <section key={sentido} className="leg-card" data-done={Boolean(lugar.elegido && lugar.point)} data-muted={deshabilitado}>
        <header className="leg-head">
          <span className="leg-badge" aria-hidden="true">{numero}</span>
          <div className="leg-head-text">
            <span className="leg-kicker">{numero === 1 ? "Ida" : "Vuelta"}</span>
            <h3 className="leg-title">{titulo}</h3>
          </div>
          {lugar.elegido && lugar.point ? <span className="leg-check" aria-label="Lugar confirmado">✓</span> : null}
        </header>
        {/* Los atajos primero, en botones grandes; escribir la dirección queda como tercera opción. */}
        <div className="place-shortcuts">
          <button type="button" className="place-shortcut" disabled={deshabilitado || ubicando === sentido}
            aria-pressed={lugar.elegido && lugar.origen === "ubicacion"} onClick={() => usarMiUbicacion(sentido)}>
            <span className="place-shortcut-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" /><circle cx="12" cy="12" r="7.5" /><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" /></svg>
            </span>
            <span className="place-shortcut-text">
              <b>{ubicando === sentido ? "Buscando dónde estás…" : "Usar mi ubicación actual"}</b>
              <small>Si ya está en el lugar</small>
            </span>
          </button>
          {officePickup ? (
            <button type="button" className="place-shortcut" disabled={deshabilitado}
              aria-pressed={lugar.elegido && lugar.origen === "sucursal"} onClick={() => usarSucursal(sentido)}>
              <span className="place-shortcut-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 21V9l8-5 8 5v12" /><path d="M9 21v-6h6v6M3 21h18" /></svg>
              </span>
              <span className="place-shortcut-text">
                <b>{sentido === "ARRIVAL" ? `Ir a ${officePickup.label}` : `Desde ${officePickup.label}`}</b>
                <small>{officePickup.address}</small>
              </span>
            </button>
          ) : null}
        </div>
        {errorUbicacion[sentido] ? <p className="field-error" role="alert">{errorUbicacion[sentido]}</p> : null}
        <p className="place-or">o escribí la dirección:</p>
        <AirportPlaceSearch
          coverage={coverage}
          useGoogle={googlePickupConfigured}
          disabled={deshabilitado}
          onChange={() => (sentido === "ARRIVAL" ? setPickupLlegada(lugarVacio) : setPickupVuelta(lugarVacio))}
          onSelect={(place) => elegirLugar(sentido, place)}
        />
        {lugar.elegido ? (
          <p className="muted">
            <strong>{lugar.label || "Punto elegido en el mapa"}</strong>
            {lugar.approximate ? " · referencia (no encontramos la altura exacta)" : ""}
          </p>
        ) : null}
        <AirportDraggableMap point={lugar.point} approximate={lugar.approximate} precision={lugar.precision}
          disabled={deshabilitado} onMove={(point) => { markPoint(point); return true; }} onSelect={markPoint} />
        {lugar.origen === "mapa" && lugar.point ? <MapPointAddress point={lugar.point} onResult={(label) => {
          ponerLugar(sentido, { ...lugar, label, elegido: true });
        }} /> : null}
        {/* El mapa ya dice «Arrastrá el marcador…»: no se repite abajo. */}
      </section>
    );
  }

  const fueraDeZona = Boolean(
    coverage.enabled && ((pickupLlegada.point && !isInsideAirportPickupZone(pickupLlegada.point, coverage)) ||
      (pickupVuelta.point && !isInsideAirportPickupZone(pickupVuelta.point, coverage)))
  );

  const precioLlegada = fares.ARRIVAL?.priceCents ?? route.priceCents;
  const precioVuelta = fares.DEPARTURE?.priceCents ?? route.priceCents;
  const moneda = fares.ARRIVAL?.currency ?? route.currency;
  const monedaVuelta = fares.DEPARTURE?.currency ?? route.currency;
  const quote = roundTripQuote({
    arrival: { priceCents: precioLlegada, currency: moneda, point: pickupLlegada.point, label: pickupLlegada.label },
    departure: { priceCents: precioVuelta, currency: monedaVuelta, point: pickupVuelta.point, label: pickupVuelta.label },
    passengerCount, halfFareCount, freeFareCount, sportsLuggageCount, coverage, extras
  });
  const totalTexto = quote.totals.map((total) => formatPrice(total.amountCents, total.currency)).join(" + ");
  const resumenTramos = orderedRoundTrip(
    { flight: llegada, quote: quote.arrival }, { flight: vuelta, quote: quote.departure }, orden
  );

  async function cargarVuelos(fecha: string, sentido: "ARRIVAL" | "DEPARTURE") {
    const setCargando = sentido === "ARRIVAL" ? setCargandoLlegada : setCargandoVuelta;
    const setVuelos = sentido === "ARRIVAL" ? setVuelosLlegada : setVuelosVuelta;
    const request = ++flightRequests.current[sentido];
    setVuelos([]);
    setCargando(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/airport/flights?slug=${encodeURIComponent(route.slug)}&date=${fecha}`);
      const data = await res.json();
      if (request !== flightRequests.current[sentido]) return;
      setVuelos(res.ok ? data.flights ?? [] : []);
      if (!res.ok) setError(data?.error?.message ?? "No pudimos traer los vuelos de ese día.");
    } catch {
      if (request !== flightRequests.current[sentido]) return;
      setVuelos([]);
      setError("No pudimos traer los vuelos de ese día. Probá de nuevo.");
    }
    setCargando(false);
  }

  function elegirLugar(sentido: "ARRIVAL" | "DEPARTURE", place: AirportSelectedPlace) {
    const lugar: LugarPickup = {
      label: place.label.slice(0, 160),
      point: place.point,
      precision: place.precision,
      approximate: place.approximate,
      elegido: true,
      origen: "busqueda"
    };
    ponerLugar(sentido, lugar);
  }

  /** Con «mismo lugar» sólo escribe el primer tramo; el otro se copia solo. */
  function ponerLugar(sentido: Sentido, lugar: LugarPickup) {
    setErrorUbicacion((actual) => ({ ...actual, [sentido]: undefined }));
    if (!mismoLugar || sentido === tramoAncla) {
      if (sentido === "ARRIVAL") setPickupLlegada(lugar);
      else setPickupVuelta(lugar);
    }
  }

  /** «Usar mi ubicación actual»: el punto del teléfono, sin dirección escrita (el chofer ve el pin). */
  function usarMiUbicacion(sentido: Sentido) {
    if (!("geolocation" in navigator)) {
      setErrorUbicacion((actual) => ({ ...actual, [sentido]: "Este navegador no da la ubicación. Buscá la dirección abajo." }));
      return;
    }
    setUbicando(sentido);
    setErrorUbicacion((actual) => ({ ...actual, [sentido]: undefined }));
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setUbicando(null);
      ponerLugar(sentido, {
        label: "Tu ubicación actual",
        point: [coords.latitude, coords.longitude],
        precision: "exact",
        approximate: false,
        elegido: true,
        origen: "ubicacion"
      });
    }, () => {
      setUbicando(null);
      setErrorUbicacion((actual) => ({ ...actual, [sentido]: "No pudimos saber dónde estás. Revisá el permiso de ubicación o buscá la dirección abajo." }));
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  }

  /** Atajo de la sucursal: deja la dirección y el punto de la oficina en ese tramo. */
  function usarSucursal(sentido: "ARRIVAL" | "DEPARTURE") {
    if (!officePickup) return;
    const lugar: LugarPickup = {
      label: officePickup.address,
      point: officePickup.point,
      precision: "exact",
      approximate: false,
      elegido: true,
      origen: "sucursal"
    };
    ponerLugar(sentido, lugar);
  }

  function updatePassenger(field: keyof PassengerForm, value: string) {
    setPassenger((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function validarPaso1() {
    if (!llegada || !llegada.bookable) return "Elegí tu vuelo de llegada a Chapelco.";
    if (!vuelta || !vuelta.bookable) return "Elegí tu vuelo de salida desde San Martín.";
    // El segundo tramo sigue al primero, se arranque llegando o saliendo.
    if (orden === "ARRIVAL" && fechaVuelta < fechaLlegada) return "La vuelta no puede ser antes de la llegada.";
    if (orden === "DEPARTURE" && fechaLlegada < fechaVuelta) return "La vuelta no puede ser antes de la salida.";
    if (!roundTripOrderValid(llegada, vuelta, orden)) return "El vuelo de vuelta debe ser posterior al vuelo de ida. Revisá los horarios.";
    return "";
  }

  function validarPaso2() {
    const primeroListo = orden === "ARRIVAL" ? pickupLlegadaListo : pickupVueltaListo;
    if (!primeroListo) return orden === "ARRIVAL" ? "Elegí adónde lo llevamos cuando llega." : "Elegí dónde lo buscamos para ir al aeropuerto.";
    if (respuestaMismo === null) return "Contanos si la vuelta es en el mismo lugar.";
    if (!pickupLlegadaListo) return "Confirmá el lugar del traslado de la llegada.";
    if (!pickupVueltaListo) return "Confirmá el lugar del traslado de la vuelta.";
    if (fueraDeZona) return OUTSIDE_PICKUP_ZONE;
    return "";
  }

  /** Muestra el problema arriba del formulario y lo deja a la vista (puede estar lejos de donde está la persona). */
  function mostrarProblema(problema: string) {
    setError(problema);
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  /** El botón del resumen antes de tener todo: dice qué falta y lo muestra. */
  function avanzar() {
    const problema = validarPaso1() || validarPaso2();
    if (problema) mostrarProblema(problema);
    else datosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** Lo que viaja a la API por cada tramo: la ubicación del teléfono va sólo como punto. */
  function pickupDelPedido(lugar: LugarPickup) {
    return {
      pickupName: lugar.origen === "sucursal" && officePickup ? officePickup.label : undefined,
      pickupAddress: lugar.origen === "ubicacion" ? undefined : lugar.label || undefined,
      pickupPoint: lugar.point ?? undefined
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problemaVuelos = validarPaso1();
    if (problemaVuelos) { mostrarProblema(problemaVuelos); return; }
    const problemaPickups = validarPaso2();
    if (problemaPickups) { mostrarProblema(problemaPickups); return; }
    // El documento (#206) y el email (#239) son opcionales en el ida y vuelta: nombre y teléfono alcanzan.
    const erroresPasajero = validateCheckoutPassenger(passenger, true, true);
    if (Object.keys(erroresPasajero).length > 0) {
      setFieldErrors(erroresPasajero);
      mostrarProblema("Revisá los datos del pasajero.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    try {
      // Una clave por viaje: el reintento después de una respuesta perdida devuelve los dos tramos
      // que ya existen en vez de crear otro viaje (#139).
      claveDeIdempotencia.current ||= nuevaClaveDeIdempotencia();
      const res = await fetch(`/api/v1/airport/reservations/round-trip${fromAdmin ? "?source=admin" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: claveDeIdempotencia.current,
          routeSlug: route.slug,
          firstLeg: orden,
          passengerCount,
          halfFareCount,
          freeFareCount,
          sportsLuggageCount,
          referredBy: fromAdmin ? referredBy.trim() || undefined : undefined,
          passenger: buildPassengerPayload(passenger),
          arrival: {
            flightNumber: llegada!.number,
            serviceDate: fechaLlegada,
            ...pickupDelPedido(pickupLlegada)
          },
          departure: {
            flightNumber: vuelta!.number,
            serviceDate: fechaVuelta,
            ...pickupDelPedido(pickupVuelta)
          }
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "No pudimos crear la reserva. Probá de nuevo.");
        return;
      }
      // En el panel no hay comprobante que pagar: se vuelve a la reserva para seguir operando.
      if (fromAdmin) {
        const primero = orden === "ARRIVAL" ? data.roundTrip.arrival : data.roundTrip.departure;
        setRedirecting(true);
        router.push(`/admin/reservas/${primero.code}`);
        return;
      }
      setResultado(data.roundTrip);
    } catch {
      setError("No pudimos crear la reserva. Revisá tu conexión y volvé a intentar.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (resultado) {
    return (
      <section className="form-panel checkout-panel" aria-live="polite">
        <p className="eyebrow">Reserva recibida</p>
        <h2 className="route-title">Ida y vuelta reservada</h2>
        <p className="muted">
          Te tomamos los dos tramos con los mismos datos. Cada tramo se paga por separado y tiene su
          propio comprobante.
        </p>
        <div className="summary-list">
          {orderedRoundTrip(resultado.arrival, resultado.departure, orden).map(({ label: etiqueta, value: tramo }) => (
            <div key={tramo.code}>
              <span>{etiqueta} · {tramo.flightNumber ?? "vuelo"} · {tramo.serviceDate ? fechaCorta(String(tramo.serviceDate).slice(0, 10)) : ""}</span>
              <strong>{formatShortCode(tramo.shortCode)}</strong>
              <Link className="table-link" href={`/reservas/${tramo.code}`}>
                Ver el comprobante y pagar
              </Link>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const searchBar = (
    <TripSearchBar locale={locale}
      orden={orden}
      lugaresExtra={privateCheckout ? undefined : lugaresExtra}
      privatePlace={privateCheckout?.place}
      abrirLaVuelta={abrirLaVuelta}
      tramos={bloquesDelViaje.map((bloque, i): TramoDeLaBarra => ({
        sentido: bloque.sentido,
        etapa: i === 0 ? "Ida" : "Vuelta",
        titulo: bloque.titulo,
        pregunta: bloque.pregunta,
        fecha: bloque.fecha,
        // En la web no se reserva para días que ya pasaron; el panel puede cargar atrasados.
        minimo: bloque.minimo || (fromAdmin ? "" : new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)),
        opciones: bloque.opciones,
        elegido: bloque.elegido,
        cargando: bloque.cargando
      })) as [TramoDeLaBarra, TramoDeLaBarra]}
      routeSlug={route.slug}
      confirmarCambio={confirmarCambio}
      onPedirOrden={pedirOrden}
      onConfirmarCambio={cambiarOrden}
      onCancelarCambio={() => setConfirmarCambio(false)}
      onFecha={(sentido, fecha) => {
        if (sentido === "ARRIVAL") { setFechaLlegada(fecha); setLlegadaId(""); }
        else { setFechaVuelta(fecha); setVueltaId(""); }
        void cargarVuelos(fecha, sentido);
      }}
      onVuelo={(sentido, vueloId) => {
        if (sentido === "ARRIVAL") setLlegadaId(vueloId);
        else setVueltaId(vueloId);
        setError("");
      }}
      // La cruz de la vuelta vuelve a la reserva de un tramo con el primer tramo ya elegido (18-nov).
      quitarVueltaHref={hrefConViaje(
        singleHrefs?.[orden] ?? `/reservar/${route.slug}?sentido=${orden}`,
        {
          date: orden === "ARRIVAL" ? fechaLlegada : fechaVuelta,
          sentido: orden,
          vuelo: (orden === "ARRIVAL" ? llegadaId : vueltaId) || undefined
        }
      )}
    />
  );

  if (privateCheckout) {
    return privateCheckout.renderForm(searchBar, bloquesDelViaje.map(bloque => ({
      date: bloque.fecha, direction: bloque.sentido,
      flight: bloque.opciones.find(vuelo => vuelo.id === bloque.elegido) ?? null,
      clearFlight: () => bloque.setElegido("")
    })), error);
  }

  return (
    <form className="checkout-layout" onSubmit={handleSubmit} noValidate>
      <div className="checkout-main">
        <section className="form-panel checkout-panel">
          {/* Indicador de por dónde va: se completa solo, no hay que tocarlo. */}
          <ol className="wizard-steps checkout-progress" aria-label="Pasos de la reserva">
            {ETAPAS.map((titulo, i) => {
              const hecha = [vuelosListos, lugaresListos, false][i];
              const activa = i === (lugaresListos ? 2 : vuelosListos ? 1 : 0);
              return (
                <li key={titulo} data-active={activa} data-done={hecha} aria-current={activa ? "step" : undefined}>
                  <span>{hecha ? "✓" : i + 1}</span>
                  {titulo}
                </li>
              );
            })}
          </ol>

          {error ? <p className="error" role="alert" ref={errorRef}>{error}</p> : null}

          <>
              <div>
                <p className="eyebrow">Los vuelos</p>
                <h2 className="route-title">Tus dos vuelos</h2>
                <p className="muted">
                  Tocá cada recuadro para elegir: desde dónde sale, adónde va, y el día y el vuelo de la ida
                  y de la vuelta. La vuelta puede ser otro día.
                </p>
              </div>

              {/* Barra al estilo de los buscadores de vuelos (pedido de Jugue, 17-nov: «como en Kiwi»):
                  cada campo abre su panel con los lugares, o con los días y los vuelos para tocar. */}
              {searchBar}
              <p className="trip-search-hint"><strong>{fraseOrden}.</strong></p>
              {(() => {
                const retiroPaihuen = isPaihuen(null, pickupVuelta.label, pickupVuelta.point);
                const inicio = paihuenPickupTime(vuelta ? inicioDeRecorrida(vuelta) : null, retiroPaihuen);
                return inicio ? (
                  <p className="trip-search-hint trip-search-pickup-time">
                    <strong>{retiroPaihuen ? "Lo pasamos a buscar el" : "Inicio de la recorrida el"} {airportPickupDateTime.format(inicio)} h</strong>{" "}
                    {retiroPaihuen ? "Paihuén es la primera parada, 15 minutos antes del inicio habitual." : null}
                  </p>
                ) : null;
              })()}
              <p className="sr-only" aria-live="polite">{fraseOrden}</p>

              {/* Con los dos vuelos elegidos aparecen los lugares, sin apretar «Continuar». */}
              {lugaresAbiertos ? (
                <section className="pickup-flow" ref={lugaresRef} aria-labelledby="pickup-flow-titulo">
                  {/* Sin encabezado a la vista (pedido de Jugue, 18-nov): así la barra de los vuelos sigue en pantalla.
                      El título queda para el lector de pantalla y para llevarle el foco. */}
                  <h2 className="sr-only" id="pickup-flow-titulo" tabIndex={-1}>{textosLugar.titulo}</h2>

                  {tarjetaLugar(orden, textosLugar.primero, 1, false)}

                  {primerLugarListo ? (
                    <div className="same-place" ref={preguntaRef} role="group" aria-labelledby="same-place-pregunta">
                      <p className="same-place-question" id="same-place-pregunta">{textosLugar.pregunta}</p>
                      <div className="same-place-options">
                        <button type="button" className="same-place-option" aria-pressed={respuestaMismo === "si"}
                          onClick={() => setRespuestaMismo("si")}>
                          <b>Sí, el mismo lugar</b>
                          <small>{lugarAncla.label || "El punto elegido en el mapa"}</small>
                        </button>
                        <button type="button" className="same-place-option" aria-pressed={respuestaMismo === "no"}
                          onClick={() => {
                            // Arranca vacío: si no, quedaría la copia del primero y parecería ya elegido.
                            if (respuestaMismo !== "no") {
                              if (orden === "ARRIVAL") setPickupVuelta(lugarVacio);
                              else setPickupLlegada(lugarVacio);
                            }
                            setRespuestaMismo("no");
                          }}>
                          <b>No, es otro lugar</b>
                          <small>Lo elijo ahora</small>
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {primerLugarListo && respuestaMismo === "no" ? tarjetaLugar(segundoSentido, textosLugar.segundo, 2, false) : null}

                </section>
              ) : null}
          </>

          {/* Con los lugares listos aparecen los datos del pasajero, sin apretar «Continuar». */}
          {datosAbiertos ? (
            <section className="pickup-flow" ref={datosRef} aria-labelledby="datos-titulo">
              <div>
                <p className="eyebrow">Tus datos</p>
                <h2 className="route-title" id="datos-titulo" tabIndex={-1}>¿Quiénes viajan?</h2>
                <p className="muted">Los cargás una sola vez y valen para los dos tramos.</p>
              </div>

              <div className="checkout-fields">
                {/* Un solo rótulo por contador: antes se leía «Adultos» dos veces (label adentro de label). */}
                <div>
                  <QuantityPicker label="Adultos" value={fullFareCount} min={1} max={24} onChange={setFullFareCount} />
                </div>
                <div>
                  <QuantityPicker label="Menores de 4 a 8 años (media tarifa)" value={halfFareCount} min={0} max={23} onChange={setHalfFareCount} />
                </div>
                <div>
                  <QuantityPicker label="Menores de 4 años (sin cargo)" value={freeFareCount} min={0} max={23} onChange={setFreeFareCount} />
                </div>
                <div>
                  <QuantityPicker label="Equipaje deportivo (esquí, snowboard, bici)" value={sportsLuggageCount} min={0} max={24} onChange={setSportsLuggageCount} />
                  <span className="muted">
                    {extras.sportsLuggageCents > 0
                      ? `${formatPrice(extras.sportsLuggageCents, moneda)} por bulto, en cada tramo`
                      : "Sin cargo"}
                  </span>
                </div>
              </div>

              <PassengerFields
                passenger={passenger}
                fieldErrors={fieldErrors}
                onChange={updatePassenger}
                optionalIdentity
                optionalDocument
              />

              {fromAdmin ? (
                <div className="checkout-fields">
                  <label>
                    Derivado por (opcional)
                    <input maxLength={120} value={referredBy} onChange={(event) => setReferredBy(event.target.value)}
                      placeholder="Ej. una agencia de viajes" disabled={isSubmitting} />
                    <small>Quién vendió la reserva. Vale para los dos tramos y sale en la orden de servicio del chofer.</small>
                  </label>
                </div>
              ) : null}

              <div className="summary-list plain-card">
                {resumenTramos.map(({ label, value }) => (
                  <div key={label}>
                    <span>{label} · {value.flight ? descripcionVuelo(value.flight) : "sin vuelo"}
                      {value.quote.extras.zoneExtraCents > 0 ? ` · incluye recargo de zona ${formatPrice(value.quote.extras.zoneExtraCents, value.quote.currency)}` : ""}
                      {sportsLuggageCount > 0 ? ` · incluye equipaje ${formatPrice(value.quote.extras.sportsLuggageTotalCents, value.quote.currency)}` : ""}
                    </span>
                    <strong>{formatPrice(value.quote.totalCents, value.quote.currency)}</strong>
                  </div>
                ))}
                <div>
                  <span>Total de los dos tramos</span>
                  <strong>{totalTexto}</strong>
                </div>
                <div>
                  <span>Pickup</span>
                  <strong>{pickupLlegada.label || "punto confirmado"}{mismoLugar ? " (mismo lugar en la vuelta)" : ` · vuelta: ${pickupVuelta.label || "otro punto"}`}</strong>
                </div>
              </div>

              <button className="button pickup-flow-next" type="submit" disabled={isSubmitting || fueraDeZona}>
                {isSubmitting ? "Reservando…" : "Reservar ida y vuelta"}
              </button>
            </section>
          ) : null}
        </section>
      </div>

      <aside className="checkout-summary plain-card">
        <p className="eyebrow">Resumen</p>
        <h2 className="route-title">Ida y vuelta</h2>
        <div className="summary-list">
          {bloquesDelViaje.map(({ sentido, etapa, fecha, opciones, elegido }) => {
            const vueloElegido = opciones.find((opcion) => opcion.id === elegido) ?? null;
            const pata = sentido === "ARRIVAL" ? PATA_LLEGADA : PATA_SALIDA;
            return (
              <div key={sentido}>
                <span>{etapa} · {pata.etiqueta} {pata.ruta}</span>
                <strong>{fechaCorta(fecha)}{vueloElegido ? ` · ${descripcionVuelo(vueloElegido)}` : " · sin vuelo"}</strong>
              </div>
            );
          })}
          <div>
            <span>Pickup</span>
            <strong>
              {(() => {
                const primero = orden === "ARRIVAL" ? pickupLlegada : pickupVuelta;
                const segundo = orden === "ARRIVAL" ? pickupVuelta : pickupLlegada;
                if (!primero.elegido && !segundo.elegido) return llegada && vuelta ? "Sin confirmar todavía" : "Se elige después de los vuelos";
                const nombre = (lugar: LugarPickup) => (lugar.elegido ? lugar.label || "punto elegido en el mapa" : "sin confirmar");
                return mismoLugar ? `${nombre(primero)} (mismo lugar en los dos tramos)` : `${nombre(primero)} · vuelta: ${nombre(segundo)}`;
              })()}
            </strong>
          </div>
          <div>
            <span>Pasajeros</span>
            <strong>
              {passengerCount}
              {halfFareCount > 0 ? ` · ${halfFareCount} con media tarifa` : ""}
              {freeFareCount > 0 ? ` · ${freeFareCount} sin cargo` : ""}
              {sportsLuggageCount > 0 ? ` · ${sportsLuggageCount} bulto(s) deportivo(s)` : ""}
            </strong>
          </div>
          <div>
            <span>Tarifa</span>
            <strong>{formatPrice(precioLlegada, moneda)} la llegada · {formatPrice(precioVuelta, monedaVuelta)} la salida, por persona</strong>
          </div>
        </div>
        {resumenTramos.filter(({ value }) => value.quote.paihuenCents > 0).map(({ label, value }) => (
          <p className="muted" key={label}>{label} · Adicional Paihuén ({passengerCount} × $13.000): {formatPrice(value.quote.paihuenCents, value.quote.currency)}</p>
        ))}
        {resumenTramos.filter(({ value }) => value.quote.extras.zoneExtraCents > 0).map(({ label, value }) => (
          <p className="muted" key={label}>{label}: incluye recargo de zona {formatPrice(value.quote.extras.zoneExtraCents, value.quote.currency)}</p>
        ))}
        <strong className="price">{totalTexto}</strong>
        {!lugaresListos ? (
          <button className="button checkout-submit" type="button" onClick={avanzar}>
            {vuelosListos ? "Falta elegir los lugares" : "Elegí los dos vuelos"}
          </button>
        ) : (
          <button className="button checkout-submit" type="submit" disabled={isSubmitting || fueraDeZona}>
            {isSubmitting ? "Reservando…" : "Reservar ida y vuelta"}
          </button>
        )}
        <p className="muted legal-consent">
          Al confirmar, aceptás los <Link href="/terminos">términos y condiciones</Link> y la{" "}
          <Link href="/privacidad">política de privacidad</Link>.
        </p>
      </aside>
    </form>
  );
}
