"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
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

export function RoundTripCheckoutForm({ route, fares, initialDate, initialFlights, coverage, extras, officePickup = null }: RoundTripCheckoutFormProps) {
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
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
  const [passenger, setPassenger] = useState<PassengerForm>(initialPassenger);
  const [fieldErrors, setFieldErrors] = useState<PassengerFieldErrors>({});

  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultado, setResultado] = useState<{ id: string; arrival: TramoCreado; departure: TramoCreado } | null>(null);

  const llegada = useMemo(() => vuelosLlegada.find((v) => v.id === llegadaId) ?? null, [vuelosLlegada, llegadaId]);
  const vuelta = useMemo(() => vuelosVuelta.find((v) => v.id === vueltaId) ?? null, [vuelosVuelta, vueltaId]);
  const opcionesLlegada = reservablesDe(vuelosLlegada, "ARRIVAL");
  const opcionesVuelta = reservablesDe(vuelosVuelta, "DEPARTURE");
  const passengerCount = fullFareCount + halfFareCount + freeFareCount;

  // La vuelta usa el mismo lugar que la llegada cuando el pasajero lo pide (es el caso normal).
  useEffect(() => {
    if (mismoLugar) setPickupVuelta(pickupLlegada);
  }, [mismoLugar, pickupLlegada]);

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
    if (sentido === "ARRIVAL") setPickupLlegada(lugar);
    else if (!mismoLugar) setPickupVuelta(lugar);
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
    if (sentido === "ARRIVAL") setPickupLlegada(lugar);
    else if (!mismoLugar) setPickupVuelta(lugar);
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
    if (!vuelta || !vuelta.bookable) return "Elegí tu vuelo de salida desde Chapelco.";
    if (fechaVuelta < fechaLlegada) return "La vuelta no puede ser antes de la llegada.";
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
    const erroresPasajero = validateCheckoutPassenger(passenger);
    if (Object.keys(erroresPasajero).length > 0) {
      setFieldErrors(erroresPasajero);
      setError("Revisá los datos del pasajero.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/v1/airport/reservations/round-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routeSlug: route.slug,
          passengerCount,
          halfFareCount,
          freeFareCount,
          sportsLuggageCount,
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
                <span>{i + 1}</span>
                {titulo}
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
                  Elegí el vuelo de llegada a Chapelco y el de salida. Podés volver otro día.
                </p>
              </div>

              {[
                { sentido: "ARRIVAL" as const, titulo: "Llegada a Chapelco", ayuda: "El vuelo en el que aterrizás.", fecha: fechaLlegada, opciones: opcionesLlegada, elegido: llegadaId, setElegido: setLlegadaId, cargando: cargandoLlegada },
                { sentido: "DEPARTURE" as const, titulo: "Salida desde San Martín", ayuda: "El vuelo con el que te vas.", fecha: fechaVuelta, opciones: opcionesVuelta, elegido: vueltaId, setElegido: setVueltaId, cargando: cargandoVuelta }
              ].map(({ sentido, titulo, ayuda, fecha, opciones, elegido, setElegido, cargando }) => (
                <div key={sentido} className="plain-card admin-section">
                  <h3 className="section-title">{titulo}</h3>
                  <p className="muted">{ayuda}</p>
                  <div className="checkout-fields">
                    <label>
                      Día
                      <input
                        type="date"
                        value={fecha}
                        min={sentido === "DEPARTURE" ? fechaLlegada : undefined}
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
                </div>
              ))}

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

              {[{ sentido: "ARRIVAL" as const, titulo: "Lugar de la llegada", lugar: pickupLlegada, deshabilitado: false },
                { sentido: "DEPARTURE" as const, titulo: "Lugar de la vuelta", lugar: pickupVuelta, deshabilitado: mismoLugar }].map(({ sentido, titulo, lugar, deshabilitado }) => (
                <div key={sentido} className="plain-card admin-section">
                  <h3 className="section-title">{titulo}</h3>
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
                </div>
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

              <PassengerFields passenger={passenger} fieldErrors={fieldErrors} onChange={updatePassenger} />

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
    </form>
  );
}
