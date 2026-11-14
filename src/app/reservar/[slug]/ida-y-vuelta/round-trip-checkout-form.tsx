"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fareCounts, reservationTotalCents } from "@/lib/booking/passenger-fares";
import { AirportPlaceSearch, type AirportSelectedPlace } from "@/components/airport-place-search";
import { googlePickupConfigured } from "@/lib/airport/google-maps";
import type { AirportOfficePickup } from "@/lib/airport/office-pickup";
import { isInsideAirportPickupZone, OUTSIDE_PICKUP_ZONE, type AirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import type { PickupPrecision } from "@/lib/airport/place-suggestions";
import { AirportDraggableMap } from "@/components/airport-draggable-map";
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
  reason: string | null;
};

type Fare = { priceCents: number; currency: string } | null;

type RoundTripCheckoutFormProps = {
  route: { slug: string; from: string; to: string; priceCents: number; currency: string };
  fares: Record<"ARRIVAL" | "DEPARTURE", Fare>;
  initialDate: string;
  initialFlights: FlightOption[];
  coverage: AirportCoverage;
  /** Precio por bulto de equipaje deportivo (esquí, snowboard, bici), vigente al reservar. */
  extras: { sportsLuggageCents: number };
  /** Atajo «salir desde la sucursal» (#34): sólo llega si está activo y con punto. */
  officePickup?: (AirportOfficePickup & { point: [number, number] }) | null;
  /** Alta desde el panel: identidad opcional, sin freno por IP y vuelve a la reserva del panel. */
  fromAdmin?: boolean;
};

type LugarPickup = {
  label: string;
  point: PickupPoint | null;
  precision: PickupPrecision | null;
  approximate: boolean;
  elegido: boolean;
};

const lugarVacio: LugarPickup = { label: "", point: null, precision: null, approximate: false, elegido: false };

type TramoCreado = {
  code: string;
  shortCode: string;
  totalCents: number;
  currency: string;
  flightNumber: string | null;
  direction: string | null;
  serviceDate: string | null;
};

const PASOS = ["Ida y vuelta", "Los pickups", "Tus datos"];

/**
 * Las dos patas del viaje. Los sentidos son fijos (la llegada siempre es CPC → SMA, la salida
 * siempre SMA → CPC); el orden elegido decide cuál va primero en el calendario.
 */
const PATA_LLEGADA = { etiqueta: "Llegada", ruta: "CPC → SMA" };
const PATA_SALIDA = { etiqueta: "Salida", ruta: "SMA → CPC" };

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
function reservablesDe(vuelos: FlightOption[], direction: "ARRIVAL" | "DEPARTURE") {
  return vuelos.filter((vuelo) => vuelo.direction === direction && vuelo.bookable);
}

function descripcionVuelo(vuelo: FlightOption) {
  const partes = [vuelo.number, hhmm(vuelo.estimatedAt ?? vuelo.scheduledAt)];
  if (vuelo.origin) partes.push(vuelo.origin);
  return partes.join(" · ");
}

export function RoundTripCheckoutForm({ route, fares, initialDate, initialFlights, coverage, extras, officePickup = null, fromAdmin = false }: RoundTripCheckoutFormProps) {
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  /**
   * Cuál de los dos tramos va primero en el calendario. `ARRIVAL` = llego a San Martín y después
   * me voy (CPC → SMA, SMA → CPC); `DEPARTURE` = me voy y después vuelvo (SMA → CPC, CPC → SMA).
   */
  const [orden, setOrden] = useState<"ARRIVAL" | "DEPARTURE">("ARRIVAL");
  const [redirecting, setRedirecting] = useState(false);
  const router = useRouter();
  const [fechaLlegada, setFechaLlegada] = useState(initialDate);
  const [fechaVuelta, setFechaVuelta] = useState(initialDate);
  const [vuelosLlegada, setVuelosLlegada] = useState<FlightOption[]>(initialFlights);
  const [vuelosVuelta, setVuelosVuelta] = useState<FlightOption[]>(initialFlights);
  const [llegadaId, setLlegadaId] = useState("");
  const [vueltaId, setVueltaId] = useState("");
  const [cargandoLlegada, setCargandoLlegada] = useState(false);
  const [cargandoVuelta, setCargandoVuelta] = useState(false);

  const [pickupLlegada, setPickupLlegada] = useState<LugarPickup>(lugarVacio);
  const [pickupVuelta, setPickupVuelta] = useState<LugarPickup>(lugarVacio);
  const [mismoLugar, setMismoLugar] = useState(true);

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

  const llegada = useMemo(() => vuelosLlegada.find((v) => v.id === llegadaId) ?? null, [vuelosLlegada, llegadaId]);
  const vuelta = useMemo(() => vuelosVuelta.find((v) => v.id === vueltaId) ?? null, [vuelosVuelta, vueltaId]);
  const opcionesLlegada = reservablesDe(vuelosLlegada, "ARRIVAL");
  const opcionesVuelta = reservablesDe(vuelosVuelta, "DEPARTURE");
  /**
   * Los dos tramos en el orden que eligió el pasajero. El segundo lleva `minimo` con la fecha del
   * primero: el que va después no puede ser anterior en el calendario.
   */
  /** La barra muestra las dos patas en el orden elegido: el 1º tramo a la izquierda. */
  const primerTramo = orden === "ARRIVAL" ? PATA_LLEGADA : PATA_SALIDA;
  const segundoTramo = orden === "ARRIVAL" ? PATA_SALIDA : PATA_LLEGADA;

  /** La flecha del medio: invierte el orden y limpia los vuelos ya elegidos. */
  function cambiarOrden() {
    setOrden(orden === "ARRIVAL" ? "DEPARTURE" : "ARRIVAL");
    setLlegadaId("");
    setVueltaId("");
    setError("");
  }

  const bloqueLlegada = {
    sentido: "ARRIVAL" as const,
    titulo: "Llegada a Chapelco",
    ayuda: "El vuelo en el que aterrizás.",
    fecha: fechaLlegada,
    opciones: opcionesLlegada,
    elegido: llegadaId,
    setElegido: setLlegadaId,
    cargando: cargandoLlegada
  };
  const bloqueSalida = {
    sentido: "DEPARTURE" as const,
    titulo: "Salida desde San Martín",
    ayuda: "El vuelo con el que te vas.",
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

  /** Los pickups siguen el mismo orden que los vuelos. */
  const bloquesDePickup = orden === "ARRIVAL"
    ? [
        { sentido: "ARRIVAL" as const, titulo: "Lugar de la llegada", lugar: pickupLlegada, deshabilitado: false },
        { sentido: "DEPARTURE" as const, titulo: "Lugar de la vuelta", lugar: pickupVuelta, deshabilitado: mismoLugar }
      ]
    : [
        { sentido: "DEPARTURE" as const, titulo: "Lugar de la salida", lugar: pickupVuelta, deshabilitado: false },
        { sentido: "ARRIVAL" as const, titulo: "Lugar de la vuelta", lugar: pickupLlegada, deshabilitado: mismoLugar }
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
  const fueraDeZona = Boolean(
    coverage.enabled && ((pickupLlegada.point && !isInsideAirportPickupZone(pickupLlegada.point, coverage)) ||
      (pickupVuelta.point && !isInsideAirportPickupZone(pickupVuelta.point, coverage)))
  );

  const precioLlegada = fares.ARRIVAL?.priceCents ?? route.priceCents;
  const precioVuelta = fares.DEPARTURE?.priceCents ?? route.priceCents;
  const moneda = fares.ARRIVAL?.currency ?? route.currency;
  // El equipaje deportivo se cobra por tramo: viaja en los dos.
  const equipajeCents = sportsLuggageCount * extras.sportsLuggageCents;
  const totalLlegada = reservationTotalCents(precioLlegada, fareCounts(passengerCount, halfFareCount, freeFareCount)) + equipajeCents;
  const totalVuelta = reservationTotalCents(precioVuelta, fareCounts(passengerCount, halfFareCount, freeFareCount)) + equipajeCents;

  async function cargarVuelos(fecha: string, sentido: "ARRIVAL" | "DEPARTURE") {
    const setCargando = sentido === "ARRIVAL" ? setCargandoLlegada : setCargandoVuelta;
    const setVuelos = sentido === "ARRIVAL" ? setVuelosLlegada : setVuelosVuelta;
    setCargando(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/airport/flights?slug=${encodeURIComponent(route.slug)}&date=${fecha}`);
      const data = await res.json();
      setVuelos(res.ok ? data.flights ?? [] : []);
      if (!res.ok) setError(data?.error?.message ?? "No pudimos traer los vuelos de ese día.");
    } catch {
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
      elegido: true
    };
    // Con «mismo lugar» sólo escribe el primer tramo; el otro se copia solo.
    if (!mismoLugar || sentido === tramoAncla) {
      if (sentido === "ARRIVAL") setPickupLlegada(lugar);
      else setPickupVuelta(lugar);
    }
  }

  /** Atajo de la sucursal: deja la dirección y el punto de la oficina en ese tramo. */
  function usarSucursal(sentido: "ARRIVAL" | "DEPARTURE") {
    if (!officePickup) return;
    const lugar: LugarPickup = {
      label: officePickup.address,
      point: officePickup.point,
      precision: "exact",
      approximate: false,
      elegido: true
    };
    if (!mismoLugar || sentido === tramoAncla) {
      if (sentido === "ARRIVAL") setPickupLlegada(lugar);
      else setPickupVuelta(lugar);
    }
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
    return "";
  }

  function validarPaso2() {
    if (!pickupLlegadaListo) return "Confirmá el lugar del traslado de la llegada.";
    if (!pickupVueltaListo) return "Confirmá el lugar del traslado de la vuelta.";
    if (fueraDeZona) return OUTSIDE_PICKUP_ZONE;
    return "";
  }

  function avanzar() {
    const problema = paso === 1 ? validarPaso1() : validarPaso2();
    if (problema) {
      setError(problema);
      return;
    }
    setError("");
    setPaso((actual) => (actual === 1 ? 2 : 3));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problemaPickups = validarPaso2();
    if (problemaPickups) {
      setError(problemaPickups);
      setPaso(2);
      return;
    }
    const erroresPasajero = validateCheckoutPassenger(passenger, fromAdmin);
    if (Object.keys(erroresPasajero).length > 0) {
      setFieldErrors(erroresPasajero);
      setError("Revisá los datos del pasajero.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/airport/reservations/round-trip${fromAdmin ? "?source=admin" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
            pickupAddress: pickupLlegada.label,
            pickupPoint: pickupLlegada.point ?? undefined
          },
          departure: {
            flightNumber: vuelta!.number,
            serviceDate: fechaVuelta,
            pickupAddress: pickupVuelta.label,
            pickupPoint: pickupVuelta.point ?? undefined
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
          {[
            { etiqueta: "Llegada", tramo: resultado.arrival },
            { etiqueta: "Vuelta", tramo: resultado.departure }
          ].map(({ etiqueta, tramo }) => (
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

  return (
    <form className="checkout-layout" onSubmit={handleSubmit} noValidate>
      <div className="checkout-main">
        <section className="form-panel checkout-panel">
          <ol className="wizard-steps">
            {PASOS.map((titulo, i) => (
              <li key={titulo} data-active={paso === i + 1} data-done={paso > i + 1}>
                {/* Un paso ya hecho se puede volver a abrir desde acá, igual que con «← Volver». */}
                {paso > i + 1 ? (
                  <button type="button" onClick={() => setPaso((i + 1) as 1 | 2)}>
                    <span>{i + 1}</span>
                    {titulo}
                  </button>
                ) : (
                  <>
                    <span>{i + 1}</span>
                    {titulo}
                  </>
                )}
              </li>
            ))}
          </ol>

          {error ? <p className="error" role="alert">{error}</p> : null}

          {paso === 1 ? (
            <>
              <div>
                <p className="eyebrow">Paso 1 de 3</p>
                <h2 className="route-title">Tus dos vuelos</h2>
                <p className="muted">
                  Si el viaje arranca cuando aterrizás o cuando te vas, se cambia con la flecha del
                  medio. Podés volver otro día.
                </p>
              </div>

              {/* Una sola barra con el orden del viaje (estilo Kiwi): el primer tramo a la
                  izquierda, el segundo a la derecha y la flecha del medio los da vuelta. */}
              <div className="trip-order">
                <div className="trip-order-half">
                  <span className="trip-order-paso">1º tramo</span>
                  <span className="trip-order-etiqueta">{primerTramo.etiqueta}</span>
                  <b className="trip-order-ruta">{primerTramo.ruta}</b>
                </div>
                <button
                  type="button"
                  className="trip-order-swap"
                  onClick={cambiarOrden}
                  aria-label="Dar vuelta el orden del viaje"
                  title="Dar vuelta el orden del viaje"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 8h11" />
                    <path d="m14 5 3 3-3 3" />
                    <path d="M18 16H7" />
                    <path d="m10 13-3 3 3 3" />
                  </svg>
                </button>
                <div className="trip-order-half trip-order-half-end">
                  <span className="trip-order-paso">2º tramo</span>
                  <span className="trip-order-etiqueta">{segundoTramo.etiqueta}</span>
                  <b className="trip-order-ruta">{segundoTramo.ruta}</b>
                </div>
              </div>
              <p className="trip-order-hint">
                {orden === "ARRIVAL" ? "Primero llego y después me voy" : "Primero me voy y después vuelvo"}
              </p>

              {bloquesDelViaje.map(({ sentido, etapa, titulo, ayuda, fecha, opciones, elegido, setElegido, cargando, minimo }, i) => {
                const vueloElegido = opciones.find((opcion) => opcion.id === elegido) ?? null;
                return (
                <section key={sentido} className="leg-card" data-done={Boolean(vueloElegido)}>
                  <header className="leg-head">
                    <span className="leg-badge" aria-hidden="true">{i + 1}</span>
                    <div className="leg-head-text">
                      <span className="leg-kicker">{etapa}</span>
                      <h3 className="leg-title">{titulo}</h3>
                      <p className="muted leg-help">{vueloElegido ? `${descripcionVuelo(vueloElegido)} · ${fechaCorta(fecha)}` : ayuda}</p>
                    </div>
                    {vueloElegido ? <span className="leg-check" aria-label="Vuelo elegido">✓</span> : null}
                  </header>
                  <div className="checkout-fields">
                    <label>
                      Día
                      <input
                        type="date"
                        value={fecha}
                        min={minimo || undefined}
                        onChange={(e) => {
                          if (sentido === "ARRIVAL") setFechaLlegada(e.target.value);
                          else setFechaVuelta(e.target.value);
                          setElegido("");
                          void cargarVuelos(e.target.value, sentido);
                        }}
                      />
                    </label>
                    <label>
                      Vuelo
                      <select value={elegido} onChange={(e) => setElegido(e.target.value)} disabled={cargando || opciones.length === 0}>
                        <option value="">{cargando ? "Buscando vuelos…" : opciones.length ? "Elegí tu vuelo" : "Sin vuelos para reservar ese día"}</option>
                        {opciones.map((opcion) => (
                          <option key={opcion.id} value={opcion.id}>
                            {descripcionVuelo(opcion)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {opciones.length === 0 && !cargando ? (
                    <p className="muted">
                      Si tu vuelo no figura, reservá ese tramo solo desde{" "}
                      <Link className="table-link" href={`/reservar/${route.slug}?date=${fecha}`}>
                        la reserva de un tramo
                      </Link>
                      .
                    </p>
                  ) : null}
                </section>
                );
              })}

              <div className="form-actions">
                <button className="button" type="button" onClick={avanzar}>
                  Continuar con los pickups
                </button>
              </div>
            </>
          ) : null}

          {paso === 2 ? (
            <>
              <div>
                <p className="eyebrow">Paso 2 de 3</p>
                <h2 className="route-title">¿Dónde te buscamos?</h2>
                <p className="muted">
                  En la llegada te dejamos en el domicilio; en la vuelta te pasamos a buscar. Podés usar
                  el mismo lugar o cambiar uno de los dos.
                </p>
              </div>

              <label className="checkout-checkbox">
                <input type="checkbox" checked={mismoLugar} onChange={(e) => setMismoLugar(e.target.checked)} />
                Usar el mismo lugar para la vuelta
              </label>

              {bloquesDePickup.map(({ sentido, titulo, lugar, deshabilitado }, i) => (
                <section key={sentido} className="leg-card" data-done={Boolean(lugar.elegido && lugar.point)} data-muted={deshabilitado}>
                  <header className="leg-head">
                    <span className="leg-badge" aria-hidden="true">{i + 1}</span>
                    <div className="leg-head-text">
                      <span className="leg-kicker">{i === 0 ? "1º tramo" : "2º tramo"}</span>
                      <h3 className="leg-title">{titulo}</h3>
                      {deshabilitado ? <p className="muted leg-help">Usa el mismo lugar que el primer tramo.</p> : null}
                    </div>
                    {lugar.elegido && lugar.point ? <span className="leg-check" aria-label="Lugar confirmado">✓</span> : null}
                  </header>
                  {officePickup ? (
                    <div className="form-actions">
                      <button className="ghost-button" type="button" disabled={deshabilitado} onClick={() => usarSucursal(sentido)}>
                        {sentido === "ARRIVAL" ? `Ir a ${officePickup.label}` : `Salir desde ${officePickup.label}`}
                      </button>
                    </div>
                  ) : null}
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
                  {lugar.point ? (
                    <AirportDraggableMap
                      point={lugar.point}
                      approximate={lugar.approximate}
                      precision={lugar.precision}
                      disabled={deshabilitado}
                      onMove={(point) => {
                        const actualizado = { ...lugar, point, elegido: true };
                        if (sentido === "ARRIVAL") setPickupLlegada(actualizado);
                        else setPickupVuelta(actualizado);
                        return true;
                      }}
                      onSelect={(point) => {
                        const actualizado = { ...lugar, point, elegido: true };
                        if (sentido === "ARRIVAL") setPickupLlegada(actualizado);
                        else setPickupVuelta(actualizado);
                      }}
                    />
                  ) : null}
                  {lugar.point ? (
                    <p className="muted">Arrastrá el pin si el punto no es el exacto.</p>
                  ) : null}
                </section>
              ))}

              <div className="form-actions">
                <button className="ghost-button" type="button" onClick={() => setPaso(1)}>
                  ← Volver
                </button>
                <button className="button" type="button" onClick={avanzar}>
                  Continuar con tus datos
                </button>
              </div>
            </>
          ) : null}

          {paso === 3 ? (
            <>
              <div>
                <p className="eyebrow">Paso 3 de 3</p>
                <h2 className="route-title">Tus datos</h2>
                <p className="muted">Los cargás una sola vez y valen para los dos tramos.</p>
              </div>

              <div className="checkout-fields">
                <label>
                  Adultos
                  <QuantityPicker label="Adultos" value={fullFareCount} min={1} max={24} onChange={setFullFareCount} />
                </label>
                <label>
                  Menores de 4 a 8 años (media tarifa)
                  <QuantityPicker label="Menores con media tarifa" value={halfFareCount} min={0} max={23} onChange={setHalfFareCount} />
                </label>
                <label>
                  Menores de 4 años (sin cargo)
                  <QuantityPicker label="Menores sin cargo" value={freeFareCount} min={0} max={23} onChange={setFreeFareCount} />
                </label>
                <label>
                  Equipaje deportivo (esquí, snowboard, bici)
                  <QuantityPicker label="Bultos de equipaje deportivo" value={sportsLuggageCount} min={0} max={24} onChange={setSportsLuggageCount} />
                  <span className="muted">
                    {extras.sportsLuggageCents > 0
                      ? `${formatPrice(extras.sportsLuggageCents, moneda)} por bulto, en cada tramo`
                      : "Sin cargo"}
                  </span>
                </label>
              </div>

              <PassengerFields
                passenger={passenger}
                fieldErrors={fieldErrors}
                onChange={updatePassenger}
                optionalIdentity={fromAdmin}
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
                <div>
                  <span>Llegada · {llegada ? descripcionVuelo(llegada) : "sin vuelo"}</span>
                  <strong>{formatPrice(totalLlegada, moneda)}</strong>
                </div>
                <div>
                  <span>Vuelta · {vuelta ? descripcionVuelo(vuelta) : "sin vuelo"}</span>
                  <strong>{formatPrice(totalVuelta, moneda)}</strong>
                </div>
                {sportsLuggageCount > 0 ? (
                  <div>
                    <span>Equipaje deportivo</span>
                    <strong>{sportsLuggageCount} bulto(s) · {formatPrice(equipajeCents, moneda)} por tramo</strong>
                  </div>
                ) : null}
                <div>
                  <span>Total de los dos tramos</span>
                  <strong>{formatPrice(totalLlegada + totalVuelta, moneda)}</strong>
                </div>
                <div>
                  <span>Pickup</span>
                  <strong>{pickupLlegada.label || "punto confirmado"}{mismoLugar ? " (mismo lugar en la vuelta)" : ` · vuelta: ${pickupVuelta.label || "otro punto"}`}</strong>
                </div>
              </div>

              <div className="form-actions">
                <button className="ghost-button" type="button" onClick={() => setPaso(2)}>
                  ← Volver
                </button>
                <button className="primary-button" type="submit" disabled={isSubmitting || fueraDeZona}>
                  {isSubmitting ? "Reservando…" : "Reservar ida y vuelta"}
                </button>
              </div>
            </>
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
                if (!primero.elegido && !segundo.elegido) return paso === 1 ? "Se elige en el paso 2" : "Sin confirmar todavía";
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
            <strong>{formatPrice(precioLlegada, moneda)} la llegada · {formatPrice(precioVuelta, moneda)} la vuelta, por persona</strong>
          </div>
        </div>
        <strong className="price">{formatPrice(totalLlegada + totalVuelta, moneda)}</strong>
        {paso < 3 ? (
          <button className="button checkout-submit" type="button" onClick={avanzar}>
            {paso === 1 ? "Continuar con los pickups →" : "Continuar con tus datos →"}
          </button>
        ) : (
          <button className="primary-button checkout-submit" type="submit" disabled={isSubmitting || fueraDeZona}>
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
