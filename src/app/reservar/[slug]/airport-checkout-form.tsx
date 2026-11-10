"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { airlineName } from "@/lib/airport/airlines";
import { aeropuertoLabel, tramoDeVuelo } from "@/lib/airport/airports";
import { statusLabel } from "@/lib/airport/flights";
import { AIRPORT_PICKUP_COPY, airportPickupDateTime, airportPickupStart } from "@/lib/airport/pickup-start";
import { AirlineBadge } from "@/components/airline-badge";
import { airportHalfFare, airportReservationTotal } from "@/lib/airport/passenger-fares";
import { AirportDraggableMap } from "@/components/airport-draggable-map";
import { OUTSIDE_PICKUP_ZONE, type PickupPoint } from "@/lib/airport/pickup-zone";
import {
  buildPassengerPayload,
  initialPassenger,
  PassengerFields,
  QuantityPicker,
  validateCheckoutPassenger,
  type PassengerFieldErrors,
  type PassengerForm
} from "./passenger-fields";

/** Errores del pasajero (compartidos) + los propios del aeropuerto (vuelo, lugar, cantidad). */
type AirportFieldErrors = PassengerFieldErrors & {
  flight?: string;
  passengerCount?: string;
  pickupAddress?: string;
};

/**
 * Checkout del aeropuerto, **en pasos**: primero el pasajero elige llegada o salida —y con eso se
 * filtran los vuelos—, después el día y su vuelo (con el estado que informa la aerolínea), y al
 * final sus datos. El aeropuerto no tiene salidas propias: sus salidas son los vuelos.
 */

type AirportRouteProps = {
  slug: string;
  priceCents: number;
  currency: string;
};

type FlightOption = {
  id: string;
  number: string;
  direction: "ARRIVAL" | "DEPARTURE";
  airline: string | null;
  /**
   * Aeropuerto del otro extremo del vuelo: en una llegada es de dónde viene, en una salida desde
   * Chapelco es a dónde va. Se muestra porque el número solo no alcanza para reconocer el vuelo.
   */
  origin?: string | null;
  scheduledAt: string;
  estimatedAt: string | null;
  pickupStartAt?: string | null;
  pickupStartCoordinated?: boolean;
  status: string;
  /** "API" = dato real; "ESTIMADO" = patrón proyectado (AirLabs no publica horarios futuros). */
  source?: string;
  available: number;
  bookable: boolean;
  reason: string | null;
};

type AirportCheckoutFormProps = {
  route: AirportRouteProps;
  /** Tarifa vigente por sentido: es la misma que graba la reserva (no la del slug de la página). */
  fares: Record<"ARRIVAL" | "DEPARTURE", { priceCents: number; currency: string } | null>;
  initialDirection: "ARRIVAL" | "DEPARTURE";
  initialDate: string;
  initialFlights: FlightOption[];
  fromAdmin?: boolean;
};

const PASOS = ["Llegada o salida", "Tu vuelo", "Tus datos"];

/** Los dos sentidos, como opciones claras del primer paso. */
const SENTIDOS = [
  {
    code: "ARRIVAL" as const,
    title: "Llegada a Chapelco",
    subtitle: "Aeropuerto Chapelco (CPC) → San Martín de los Andes",
    ayuda: "Me espera una combi cuando aterrizo."
  },
  {
    code: "DEPARTURE" as const,
    title: "Salida desde San Martín",
    subtitle: "San Martín de los Andes → Aeropuerto Chapelco (CPC)",
    ayuda: "Me pasan a buscar para tomar mi vuelo."
  }
];

const sentidoTexto = (d: "ARRIVAL" | "DEPARTURE") => (d === "ARRIVAL" ? "Llegada" : "Salida");

function hhmm(iso: string | null) {
  if (!iso) return "—";
  return new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);
}

/** dd/mm/aaaa: el resumen mostraba la fecha cruda del input (`2026-10-19`). */
function fechaCorta(dia: string) {
  const [anio, mes, d] = dia.split("-");
  return anio && mes && d ? `${d}/${mes}/${anio}` : dia;
}

/** "AR1656 · 14:50 · desde Ezeiza (EZE)": el tramo es lo que desambigua dos vuelos parecidos. */
function descripcionVuelo(f: FlightOption) {
  const partes = [f.number, hhmm(f.estimatedAt ?? f.scheduledAt)];
  const tramo = tramoDeVuelo({ direction: f.direction, origin: f.origin });
  if (tramo) partes.push(tramo);
  return partes.join(" · ");
}

function estadoTexto(vuelo: FlightOption) {
  if (vuelo.status === "CANCELLED") return "Cancelado";
  if (vuelo.status === "DIVERTED") return "Desviado";
  const min = Math.round(((vuelo.estimatedAt ? new Date(vuelo.estimatedAt) : new Date(vuelo.scheduledAt)).getTime() - new Date(vuelo.scheduledAt).getTime()) / 60000);
  if (min >= 30) return `Demorado ${min} min`;
  return "En horario";
}

/** Estado que muestra la lista: el que informa la API (demora, en vuelo, aterrizó, cancelado…). */
function estadoDe(f: FlightOption) {
  if (f.source === "ESTIMADO") return "Horario estimado";
  return f.status === "DELAYED" ? estadoTexto(f) : statusLabel(f.status);
}

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

export function AirportCheckoutForm({ route, fares, initialDirection, initialDate, initialFlights, fromAdmin = false }: AirportCheckoutFormProps) {
  const router = useRouter();
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [date, setDate] = useState(initialDate);
  const [flights, setFlights] = useState<FlightOption[]>(initialFlights);
  const [sentido, setSentido] = useState<"ARRIVAL" | "DEPARTURE">(
    // Si el sentido con el que entra la página no tiene tarifa activa, se arranca por el otro.
    fares[initialDirection] ? initialDirection : fares.DEPARTURE ? "DEPARTURE" : "ARRIVAL"
  );
  const [flightNumber, setFlightNumber] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [passengerCount, setPassengerCount] = useState(1);
  const [halfFareCount, setHalfFareCount] = useState(0);
  const [pickupAddress, setPickupAddress] = useState("");
  const [pickupPoint, setPickupPoint] = useState<PickupPoint | null>(null);
  const [originalPoint, setOriginalPoint] = useState<PickupPoint | null>(null);
  const [pickupMode, setPickupMode] = useState<"address" | "location">("address");
  const [pickupConfirmed, setPickupConfirmed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [approximateAddress, setApproximateAddress] = useState(false);
  const [addressLabel, setAddressLabel] = useState("");
  const locationRequest = useRef(0);
  const addressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (addressTimer.current) clearTimeout(addressTimer.current);
    locationRequest.current++;
  }, []);
  const [pickupNotes, setPickupNotes] = useState("");
  const [passenger, setPassenger] = useState<PassengerForm>(initialPassenger);
  const [fieldErrors, setFieldErrors] = useState<AirportFieldErrors>({});
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cargandoVuelos, setCargandoVuelos] = useState(false);
  // Vuelo privado: charter o avión particular que no figura en la lista del día. Lo carga el
  // pasajero y queda marcado como "privado" para que la operación lo revise.
  const [esPrivado, setEsPrivado] = useState(false);
  const [privadoNumero, setPrivadoNumero] = useState("");
  const [privadoOperador, setPrivadoOperador] = useState("");
  const [privadoOrigen, setPrivadoOrigen] = useState("");
  const [privadoHora, setPrivadoHora] = useState("");

  // La lista se filtra por el sentido elegido en el paso 1; el vuelo elegido manda en la reserva.
  const visibles = useMemo(() => flights.filter((f) => f.direction === sentido), [flights, sentido]);
  const selected = useMemo(() => flights.find((f) => f.id === selectedId) ?? null, [flights, selectedId]);
  const privadoListo = privadoNumero.trim().length >= 3 && /^\d{2}:\d{2}$/.test(privadoHora);
  const sentidoDelVuelo = esPrivado ? sentido : selected?.direction ?? sentido;
  const pickupStart = esPrivado && privadoListo
    ? airportPickupStart({ direction: sentidoDelVuelo, scheduledAt: new Date(`${date}T${privadoHora}:00-03:00`) })
    : selected?.pickupStartAt ? new Date(selected.pickupStartAt) : null;
  const pickupStartLabel = !esPrivado && selected?.pickupStartCoordinated ? "Inicio de recorrida" : "Inicio estimado de recorrida";
  // La tarifa es la de la ruta canónica de ese sentido: la misma que graba la reserva.
  const tarifa = fares[sentidoDelVuelo] ?? null;
  const precioPorPersona = tarifa?.priceCents ?? route.priceCents;
  const moneda = tarifa?.currency ?? route.currency;
  const total = airportReservationTotal(precioPorPersona, passengerCount, halfFareCount);
  const puedeSeguir = Boolean(tarifa) && (esPrivado ? privadoListo : Boolean(selected && selected.bookable));

  function selectPickupPoint(point: PickupPoint | null) {
    setApproximateAddress(false);
    setPickupPoint(point);
    setOriginalPoint(point);
    setPickupConfirmed(false);
    setAddressLabel("");
    setError((current) => current === OUTSIDE_PICKUP_ZONE ? "" : current);
    setFieldErrors((current) => ({ ...current, pickupAddress: undefined }));
  }

  function useCurrentLocation() {
    if (addressTimer.current) clearTimeout(addressTimer.current);
    const request = ++locationRequest.current;
    setSearchingAddress(false);
    setPickupMode("location");
    selectPickupPoint(null);
    setLocationError("");
    if (!navigator.geolocation) {
      setLocationError("Tu navegador no ofrece ubicación. Buscá el punto por dirección.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (request !== locationRequest.current) return;
      selectPickupPoint([coords.latitude, coords.longitude]);
      setLocating(false);
    }, () => {
      if (request !== locationRequest.current) return;
      setLocating(false);
      setLocationError("No pudimos obtener tu ubicación. Podés volver a intentar o buscar por dirección.");
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  }

  function useAddress() {
    if (addressTimer.current) clearTimeout(addressTimer.current);
    locationRequest.current++;
    setPickupMode("address");
    selectPickupPoint(null);
    setLocating(false);
    setSearchingAddress(false);
    setLocationError("");
  }

  async function searchAddress(address: string) {
    if (addressTimer.current) clearTimeout(addressTimer.current);
    const request = ++locationRequest.current;
    selectPickupPoint(null);
    setSearchingAddress(true);
    try {
      const response = await fetch("/api/v1/airport/address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: address.trim() })
      });
      const data = await response.json();
      if (request !== locationRequest.current) return;
      if (!response.ok) throw new Error(data.error?.message);
      selectPickupPoint(data.point);
      setAddressLabel(data.label);
      setApproximateAddress(data.approximate === true);
    } catch (error) {
      if (request !== locationRequest.current) return;
      const message = error instanceof Error && error.message ? error.message : "No pudimos buscar la dirección.";
      setFieldErrors((current) => ({ ...current, pickupAddress: message }));
    } finally {
      if (request === locationRequest.current) setSearchingAddress(false);
    }
  }

  function changePickupAddress(address: string) {
    if (addressTimer.current) clearTimeout(addressTimer.current);
    locationRequest.current++;
    setPickupAddress(address);
    selectPickupPoint(null);
    const shouldSearch = address.trim().length >= 3;
    setSearchingAddress(shouldSearch);
    if (shouldSearch) addressTimer.current = setTimeout(() => void searchAddress(address), 750);
  }

  function adjustPickupPoint(point: PickupPoint) {
    if (!originalPoint) return false;
    setPickupPoint(point);
    setPickupConfirmed(false);
    setError((current) => current === OUTSIDE_PICKUP_ZONE ? "" : current);
    setFieldErrors((current) => ({ ...current, pickupAddress: undefined }));
    return true;
  }

  function updatePassenger(field: keyof PassengerForm, value: string) {
    setPassenger((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const nextErrors = { ...current };
      delete nextErrors[field];
      return nextErrors;
    });
  }

  async function cargarVuelos(fecha: string) {
    setCargandoVuelos(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/airport/flights?slug=${encodeURIComponent(route.slug)}&date=${fecha}`);
      const data = await res.json();
      if (!res.ok) {
        setFlights([]);
        setError(data?.error?.message ?? "No pudimos traer los vuelos de ese día.");
      } else {
        setFlights(data.flights ?? []);
        setSelectedId("");
      }
    } catch {
      setFlights([]);
      setError("No pudimos traer los vuelos de ese día. Probá de nuevo.");
    }
    setCargandoVuelos(false);
  }

  /** El pasajero puede escribir el número de vuelo: lo buscamos entre los del día y lo seleccionamos. */
  function buscarPorNumero(valor: string) {
    const buscado = valor.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!buscado) return;
    // Si el mismo número aparece más de una vez (cargado a mano y traído de la API),
    // preferimos uno reservable: elegir uno que ya salió sería un callejón sin salida.
    const candidatos = flights.filter(
      (f) => f.number.toUpperCase().replace(/[^A-Z0-9]/g, "") === buscado && f.direction === sentido
    );
    const encontrado = candidatos.find((f) => f.bookable) ?? candidatos[0];
    if (encontrado) {
      setSelectedId(encontrado.id);
      setError(encontrado.bookable ? "" : `El vuelo ${encontrado.number} no se puede reservar: ${encontrado.reason}`);
    } else {
      setSelectedId("");
      setError(`No encontramos el vuelo ${valor.toUpperCase()} para el ${date} en ese sentido.`);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const errors: Record<string, string> = { ...validateCheckoutPassenger(passenger, fromAdmin) };
    if (esPrivado) {
      if (!privadoListo) errors.flight = "Completá el número o matrícula y la hora de tu vuelo privado.";
    } else if (!selected) {
      errors.flight = "Elegí un vuelo de la lista (o escribí el número de vuelo).";
    } else if (!selected.bookable) {
      errors.flight = selected.reason ?? "Ese vuelo no se puede reservar.";
    }
    if (!esPrivado && selected && passengerCount > selected.available) {
      errors.passengerCount = `Sólo quedan ${selected.available} lugares en ese vuelo.`;
    }
    if (pickupMode === "address" && !pickupAddress.trim()) {
      errors.pickupAddress = "Ingresá la dirección.";
    } else if (!pickupPoint || !pickupConfirmed) {
      errors.pickupAddress = "Confirmá que el punto marcado sea correcto.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError("Revisá los campos marcados.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(fromAdmin ? "/api/v1/airport/reservations?source=admin" : "/api/v1/airport/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routeSlug: route.slug,
          flightNumber: esPrivado ? privadoNumero.trim().toUpperCase() : selected!.number,
          direction: esPrivado ? sentido : selected!.direction,
          serviceDate: date,
          passengerCount,
          halfFareCount,
          passenger: buildPassengerPayload(passenger),
          pickupAddress: pickupMode === "location" ? undefined : pickupAddress.trim() || undefined,
          pickupPoint: pickupPoint ?? undefined,
          pickupNotes: pickupNotes.trim() || undefined,
          ...(esPrivado
            ? {
                privateFlight: {
                  number: privadoNumero.trim().toUpperCase(),
                  airline: privadoOperador.trim() || undefined,
                  origin: privadoOrigen.trim() || undefined,
                  scheduledAt: `${date}T${privadoHora}:00-03:00`
                }
              }
            : {})
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "No pudimos crear la reserva.");
        setIsSubmitting(false);
        return;
      }
      router.push(`${fromAdmin ? "/admin" : ""}/reservas/${data.reservation.code}`);
    } catch {
      setError("No pudimos crear la reserva. Probá de nuevo.");
      setIsSubmitting(false);
    }
  }

  return (
    <form className="checkout-layout" onSubmit={handleSubmit} noValidate>
      <div className="checkout-main">
        <section className="form-panel checkout-panel">
          <ol className="wizard-steps">
            {PASOS.map((titulo, i) => (
              <li key={titulo} data-active={paso === i + 1} data-done={paso > i + 1}>
                <span>{i + 1}</span>
                {fromAdmin && i === 2 ? "Datos del pasajero" : titulo}
              </li>
            ))}
          </ol>

          {error ? <p className="error" role="alert">{error} {error === OUTSIDE_PICKUP_ZONE ? <a href="https://wa.me/5492944649049" target="_blank" rel="noreferrer">Consultar por WhatsApp ↗</a> : null}</p> : null}

          {paso === 1 ? (
            <>
              <div>
                <p className="eyebrow">Paso 1 de 3</p>
                <h2 className="route-title">¿Llegás o te vas?</h2>
                <p className="muted">
                  Elegí para qué lado viajás: con eso te mostramos <strong>sólo los vuelos de ese sentido</strong>,
                  con el estado que informa la aerolínea.
                </p>
              </div>
              <div className="wizard-options">
                {SENTIDOS.map((s) => (
                  <button
                    type="button"
                    key={s.code}
                    className="wizard-option"
                    data-selected={sentido === s.code}
                    disabled={!fares[s.code]}
                    onClick={() => {
                      if (s.code !== sentido) {
                        useAddress();
                        setPickupAddress("");
                      }
                      setSentido(s.code);
                      setSelectedId("");
                      setError("");
                      setPaso(2);
                    }}
                  >
                    <b>{s.title}</b>
                    <span className="wizard-option-route">{s.subtitle}</span>
                    <span className="muted">{fares[s.code] ? `${s.ayuda} · ${formatPrice(fares[s.code]!.priceCents, fares[s.code]!.currency)} por persona` : "Sin tarifa activa para este sentido."}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {paso === 2 ? (
            <>
              <div>
                <p className="eyebrow">Paso 2 de 3 · {sentidoTexto(sentido)}</p>
                <h2 className="route-title">Tu vuelo</h2>
                <p className="muted">
                  {sentido === "ARRIVAL"
                    ? "Elegí el día y tu vuelo de llegada a Chapelco (CPC)."
                    : "Elegí el día y tu vuelo de salida desde Chapelco (CPC)."}
                </p>
              </div>

              <div className="checkout-fields">
                <label>
                  Día
                  <input type="date" value={date} onChange={(e) => { setDate(e.target.value); void cargarVuelos(e.target.value); }} />
                </label>
                <label>
                  Número de vuelo (opcional)
                  <input
                    value={flightNumber}
                    placeholder="Ej. AR1656"
                    onChange={(e) => setFlightNumber(e.target.value)}
                    onBlur={(e) => buscarPorNumero(e.target.value)}
                  />
                </label>
              </div>

              {cargandoVuelos ? <p className="muted">Buscando vuelos…</p> : null}

              {visibles.length === 0 && !cargandoVuelos ? (
                <p className="muted">
                  No hay vuelos {sentido === "ARRIVAL" ? "de llegada a Chapelco" : "de salida desde Chapelco"} para ese día.
                  Probá otra fecha o cargá tu vuelo privado acá abajo.
                </p>
              ) : (
                <div className="flight-options">
                  {visibles.map((f) => {
                    const tramo = tramoDeVuelo({ direction: f.direction, origin: f.origin });
                    return (
                      <label
                        key={f.id}
                        className="flight-option"
                        data-selected={selectedId === f.id}
                        data-disabled={!f.bookable}
                      >
                        <input
                          type="radio"
                          name="flight"
                          value={f.id}
                          checked={selectedId === f.id}
                          disabled={!f.bookable}
                          onChange={() => { setSelectedId(f.id); setError(""); }}
                        />
                        <AirlineBadge code={f.airline} />
                        <span className="flight-when">
                          <strong>{hhmm(f.estimatedAt ?? f.scheduledAt)}</strong>
                          <span className="muted">
                            {f.number}
                            {f.airline ? ` · ${airlineName(f.airline)}` : ""}
                            {f.source === "PASAJERO" ? " · privado" : ""}
                          </span>
                          {tramo ? <span className="flight-route">{tramo}</span> : null}
                        </span>
                        <span className="flight-state" data-status={f.status} data-estimado={f.source === "ESTIMADO"}>
                          {estadoDe(f)}
                        </span>
                        <span className="flight-seats">{f.bookable ? `${f.available} lugares` : f.reason}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {fieldErrors.flight ? <p className="field-error">{fieldErrors.flight}</p> : null}

              <div className="private-flight" data-open={esPrivado}>
                <button
                  type="button"
                  className="ghost-button private-flight-toggle"
                  onClick={() => {
                    setEsPrivado((actual) => !actual);
                    setSelectedId("");
                    setError("");
                  }}
                >
                  {esPrivado ? "← Elegir un vuelo de la lista" : "Mi vuelo no está en la lista (vuelo privado)"}
                </button>

                {esPrivado ? (
                  <div className="checkout-fields private-flight-fields">
                    <p className="muted">
                      Charter, avión particular o taxi aéreo: si no figura en la lista, cargalo con los datos que
                      tengas. Lo sumamos al día y la operación lo revisa antes del traslado.
                    </p>
                    <label>
                      Número de vuelo o matrícula
                      <input
                        value={privadoNumero}
                        placeholder="Ej. LV-BET"
                        autoComplete="off"
                        onChange={(e) => setPrivadoNumero(e.target.value)}
                      />
                    </label>
                    <label>
                      Hora {sentido === "ARRIVAL" ? "de llegada" : "de salida"}
                      <input type="time" value={privadoHora} onChange={(e) => setPrivadoHora(e.target.value)} />
                    </label>
                    <label>
                      Aerolínea u operador (opcional)
                      <input
                        value={privadoOperador}
                        placeholder="Ej. Fly Patagonia"
                        onChange={(e) => setPrivadoOperador(e.target.value)}
                      />
                    </label>
                    <label>
                      {sentido === "ARRIVAL" ? "Desde dónde viene (opcional)" : "A dónde va (opcional)"}
                      <input
                        value={privadoOrigen}
                        placeholder="Ej. Buenos Aires"
                        onChange={(e) => setPrivadoOrigen(e.target.value)}
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="wizard-nav">
                <button type="button" className="ghost-button" onClick={() => setPaso(1)}>← Volver</button>
                <button type="button" className="button" disabled={!puedeSeguir} onClick={() => setPaso(3)}>
                  Siguiente →
                </button>
              </div>
            </>
          ) : null}

          {paso === 3 ? (
            <>
              <div>
                <p className="eyebrow">Paso 3 de 3</p>
                <h2 className="route-title">{fromAdmin ? "Datos del pasajero" : "Tus datos"}</h2>
                <p className="muted">
                  Vuelo elegido:{" "}
                  <strong>
                    {esPrivado
                      ? `${privadoNumero.trim().toUpperCase()} · ${privadoHora} · vuelo privado`
                      : selected
                        ? descripcionVuelo(selected)
                        : "—"}
                  </strong>
                </p>
              </div>

              {pickupStart && Number.isFinite(pickupStart.getTime()) ? (
                <div className="plain-card ticket-summary">
                  <strong>{pickupStartLabel}: {airportPickupDateTime.format(pickupStart)}</strong>
                  <p className="muted">{AIRPORT_PICKUP_COPY}</p>
                </div>
              ) : null}
              <PassengerFields
                passenger={passenger}
                fieldErrors={fieldErrors}
                optionalIdentity={fromAdmin}
                disabled={isSubmitting}
                onChange={updatePassenger}
              />
              <div className="checkout-fields">
                <QuantityPicker
                  label="Lugares a reservar"
                  value={passengerCount}
                  max={Math.min(selected?.available ?? 24, 24)}
                  disabled={isSubmitting}
                  help={selected ? `${selected.available} lugares en ese vuelo` : undefined}
                  onChange={(count) => {
                    setPassengerCount(count);
                    setHalfFareCount((current) => Math.min(current, count));
                  }}
                />
                <QuantityPicker
                  label="Menores que pagan media tarifa"
                  value={halfFareCount}
                  min={0}
                  max={passengerCount}
                  disabled={isSubmitting}
                  help="Contalos también en los lugares a reservar."
                  onChange={setHalfFareCount}
                />
                <p className="muted" style={{ gridColumn: "1 / -1" }}>
                  De 4 a 8 años inclusive pagan media tarifa. Los menores de 4 viajan gratis si no ocupan asiento.
                  Si ocupan un asiento, pagan media tarifa, con o sin sillita.
                </p>
              </div>

              <div className="checkout-fields">
                <div className="checkout-main" style={{ gridColumn: "1 / -1" }}>
                  <strong>{sentidoDelVuelo === "ARRIVAL" ? "Punto de destino" : "Punto de búsqueda"}</strong>
                  <p className="muted">Usá tu ubicación actual si ya estás en el lugar. Si estás en otro lugar, buscá por dirección.</p>
                  <div className="form-actions">
                    <button className="ghost-button" type="button" disabled={locating || isSubmitting} onClick={useCurrentLocation}>
                      {locating ? "Buscando ubicación…" : "Usar mi ubicación actual"}
                    </button>
                    {pickupMode === "location" ? <button className="ghost-button" type="button" onClick={useAddress}>Buscar por dirección</button> : null}
                  </div>
                  {locationError ? <p role="alert" className="field-error">{locationError}</p> : null}
                </div>
                {pickupMode === "address" ? (
                  <div className="checkout-main" style={{ gridColumn: "1 / -1" }}>
                    <label>Dirección o nombre del lugar<input name="pickupAddress" autoComplete="street-address" maxLength={160} value={pickupAddress}
                      onChange={(e) => changePickupAddress(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        if (!searchingAddress && !isSubmitting && pickupAddress.trim().length >= 3) void searchAddress(pickupAddress);
                      }} /></label>
                    <button className="ghost-button" type="button" disabled={searchingAddress || isSubmitting || pickupAddress.trim().length < 3} onClick={() => void searchAddress(pickupAddress)}>
                      {searchingAddress ? "Buscando dirección…" : "Buscar dirección en el mapa"}
                    </button>
                  </div>
                ) : null}
                {fieldErrors.pickupAddress ? <p className="field-error" role="alert">{fieldErrors.pickupAddress}</p> : null}
                <AirportDraggableMap point={pickupPoint} approximate={approximateAddress} disabled={isSubmitting} onMove={adjustPickupPoint} />
                {pickupPoint && originalPoint && pickupPoint !== originalPoint ? (
                  <button type="button" className="ghost-button" disabled={isSubmitting} onClick={() => adjustPickupPoint(originalPoint)}>Volver al punto original</button>
                ) : null}
                {addressLabel ? <p className="muted" style={{ gridColumn: "1 / -1" }}>
                  {addressLabel} · <a href="https://locationiq.com">Search by LocationIQ.com</a> · Datos de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
                </p> : null}
                {pickupPoint ? (
                  <label style={{ gridColumn: "1 / -1" }}>
                    <input type="checkbox" checked={pickupConfirmed} onChange={(event) => {
                      setPickupConfirmed(event.target.checked);
                      setFieldErrors((current) => ({ ...current, pickupAddress: undefined }));
                    }} /> Confirmo que el mapa marca el lugar correcto
                  </label>
                ) : null}
                <label>Notas (opcional)<input name="pickupNotes" value={pickupNotes} onChange={(e) => setPickupNotes(e.target.value)} /></label>
              </div>

              <div className="wizard-nav">
                <button type="button" className="ghost-button" onClick={() => setPaso(2)}>← Volver</button>
                <button className="button checkout-submit" type="submit" disabled={isSubmitting || !puedeSeguir}>
                  {isSubmitting ? "Reservando…" : "Reservar"}
                </button>
              </div>
            </>
          ) : null}
        </section>
      </div>

      <aside className="checkout-summary plain-card">
        <p className="eyebrow">Resumen</p>
        <h2 className="route-title">Aeropuerto Chapelco</h2>
        <div className="summary-list">
          <span>Sentido: <strong>{sentidoTexto(sentidoDelVuelo)}</strong></span>
          <span>Día: <strong>{fechaCorta(date)}</strong></span>
          <span>{sentidoDelVuelo === "ARRIVAL" ? "Origen" : "Destino"}: <strong>{esPrivado ? privadoOrigen.trim() || "—" : selected ? aeropuertoLabel(selected.origin) ?? "—" : "—"}</strong></span>
          <span>Vuelo: <strong>{esPrivado ? privadoNumero.trim().toUpperCase() || "—" : selected ? selected.number : "—"}</strong></span>
          <span>Horario: <strong>{esPrivado ? privadoHora || "—" : selected ? hhmm(selected.estimatedAt ?? selected.scheduledAt) : "—"}</strong></span>
          <span>Estado: <strong>{esPrivado ? "Privado" : selected ? estadoDe(selected) : "—"}</strong></span>
          <span>Lugares: <strong>{passengerCount}</strong></span>
          {halfFareCount > 0 ? <span>Menores con media tarifa: <strong>{halfFareCount} · {formatPrice(airportHalfFare(precioPorPersona), moneda)} cada uno</strong></span> : null}
          <span>Tarifa: <strong>{formatPrice(precioPorPersona, moneda)} por persona</strong></span>
        </div>
        <strong className="price">{formatPrice(total, moneda)}</strong>
        {paso < 3 ? (
          <button
            className="button checkout-submit"
            type="button"
            disabled={paso === 2 && !puedeSeguir}
            onClick={() => setPaso(paso === 1 ? 2 : 3)}
          >
            {paso === 1 ? "Elegir vuelo →" : "Completar datos →"}
          </button>
        ) : (
          <button className="button checkout-submit" type="submit" disabled={isSubmitting || !puedeSeguir}>
            {isSubmitting ? "Reservando…" : "Reservar"}
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
