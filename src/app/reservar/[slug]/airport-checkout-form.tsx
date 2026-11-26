"use client";

import { useContext, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { avisoItinerario } from "@/lib/airport/data-quality";
import { aeropuertoLabel, tramoDeVuelo } from "@/lib/airport/airports";
import { PrivateAirportContext } from "./private-airport-context";
import { useAirportSearch, type FlightOption } from "./airport-search";
import { statusLabel } from "@/lib/airport/flights";
import { AIRPORT_PICKUP_COPY, airportPickupDateTime, airportPickupStart } from "@/lib/airport/pickup-start";
import type { LugarDeOtroServicio } from "./ida-y-vuelta/trip-search-bar";
import { parseReservationPrice, reservationPriceError } from "@/lib/booking/admin-price";
import { nuevaClaveDeIdempotencia } from "@/lib/booking/idempotency";
import { halfFareCents } from "@/lib/booking/passenger-fares";
import { fareCounts, reservationTotalCents } from "@/lib/booking/passenger-fares";
import { MapPointAddress } from "@/components/map-point-address";
import { isPaihuen, paihuenPickupTime, PAIHUEN_UNIT_CENTS } from "@/lib/airport/paihuen";
import { AirportDraggableMap } from "@/components/airport-draggable-map";
import { nombreDelLugarSugerido, pickupNameParaElChofer } from "./pickup-name";
import type { PickupPrecision } from "@/lib/airport/place-suggestions";
import { AirportPlaceSearch, type AirportSelectedPlace } from "@/components/airport-place-search";
import { AirportGooglePickup } from "@/components/airport-google-pickup";
import { googlePickupConfigured } from "@/lib/airport/google-maps";
import { chargesZoneExtra, isInsideAirportPickupZone, OUTSIDE_PICKUP_ZONE, type AirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import type { AirportOfficePickup } from "@/lib/airport/office-pickup";
import { airportExtrasBreakdown, MAX_SPORTS_LUGGAGE, type AirportExtras } from "@/lib/airport/extras";
import { FormErrorSummary, useFocusFirstError } from "@/components/form-errors";
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
  customPrice?: string;
  pickupAddress?: string;
};

/** Orden en que se ven los campos del aeropuerto: define a cuál va el foco (#242). */
const AIRPORT_FIELD_ORDER = [
  "flight",
  "pickupAddress",
  "passengerCount",
  "firstName",
  "lastName",
  "email",
  "phoneCountryCode",
  "phone",
  "documentType",
  "documentId",
  "customPrice"
] as const;

/**
 * Checkout del aeropuerto de **un solo tramo**, en una sola página que se va abriendo sola, igual que
 * el ida y vuelta: el mismo recuadro (Desde ⇄ Hacia, el día y el vuelo) con un solo tramo, y abajo
 * «¿Ida y vuelta?» para sumar la vuelta (pedido de Jugue, 18-nov), **después el lugar** (el
 * destino si llega, el punto de búsqueda si se va) y al final los datos del pasajero. No hay botón
 * «Continuar»: cada sección aparece cuando la anterior está resuelta (pedido de Jugue, 17-nov).
 */

type AirportRouteProps = {
  slug: string;
  priceCents: number;
  currency: string;
};

type AirportCheckoutFormProps = {
  route: AirportRouteProps;
  /** Tarifa vigente por sentido: es la misma que graba la reserva (no la del slug de la página). */
  fares: Record<"ARRIVAL" | "DEPARTURE", { priceCents: number; currency: string } | null>;
  initialDirection: "ARRIVAL" | "DEPARTURE";
  initialDate: string;
  initialFlights: FlightOption[];
  coverage: AirportCoverage;
  /** Recargo de zona y equipaje deportivo vigentes (el servidor recalcula al reservar). */
  extras: Pick<AirportExtras, "zoneExtraCents" | "sportsLuggageCents">;
  /** Atajo «salir desde la sucursal» (#34): sólo llega si está activo y con punto. */
  officePickup?: (AirportOfficePickup & { point: [number, number] }) | null;
  fromAdmin?: boolean;
  locale?: "es" | "en" | "pt";
  /** Panel: los lugares de las rutas por salida en Desde/Hacia (pantalla única de «Reservar»). */
  lugaresExtra?: LugaresExtra;
  /** A dónde lleva «Ida y vuelta»: la pantalla pública o la del panel. */
  roundTripHref?: string;
  /** El sentido ya viene elegido (tarjeta «Llegada» o «Salida» de otra pantalla): se baja a la barra. */
  startAtFlights?: boolean;
  /** Vuelo ya elegido al venir del ida y vuelta (destildar «¿Ida y vuelta?»): se conserva. */
  initialFlightId?: string;
};

/** Las etapas del indicador, en el orden en que se van abriendo. */
export const ETAPAS_DEL_CHECKOUT = ["Tu vuelo", "Los lugares", "Tus datos"] as const;

/**
 * Qué secciones se abren en el checkout de un tramo. Es el mismo criterio que el ida y vuelta, con
 * una sola pata: los lugares aparecen apenas hay vuelo y los datos apenas está resuelto el lugar.
 * Vive aparte del JSX para poder probarlo sin DOM.
 */
type LugaresExtra = { desde: LugarDeOtroServicio[]; hacia: LugarDeOtroServicio[] };

export function seccionesDelCheckoutUnTramo({ vueloListo, lugarListo }: { vueloListo: boolean; lugarListo: boolean }) {
  return {
    etapas: ETAPAS_DEL_CHECKOUT,
    lugares: vueloListo,
    datos: vueloListo && lugarListo,
    /** Etapa que se está completando: la de los datos queda abierta hasta reservar. */
    activa: lugarListo ? 2 : vueloListo ? 1 : 0,
    hechas: [vueloListo, vueloListo && lugarListo, false] as [boolean, boolean, boolean]
  };
}

/**
 * El único lugar del traslado, con el mismo criterio que `textosLugar` del ida y vuelta: en la
 * llegada el lugar es **el destino** y en la salida **el punto de búsqueda**. Como hay un solo
 * tramo no existe la pregunta «¿es el mismo lugar?».
 */
export function textoDelLugarDe(sentido: "ARRIVAL" | "DEPARTURE") {
  return sentido === "ARRIVAL"
    ? {
        titulo: "¿Adónde te llevamos cuando llegás?",
        ayuda: "El vuelo te deja en Chapelco y nosotros te acercamos hasta la puerta de tu alojamiento.",
        lugar: "Punto de destino"
      }
    : {
        titulo: "¿Dónde te pasamos a buscar?",
        ayuda: "Te buscamos por tu alojamiento y te llevamos al aeropuerto con tiempo para tu vuelo.",
        lugar: "Punto de búsqueda"
      };
}

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
  if (f.source === "ITINERARIO" && f.status === "SCHEDULED") return avisoItinerario;
  if (f.source === "ESTIMADO") return "Horario estimado";
  return f.status === "DELAYED" ? estadoTexto(f) : statusLabel(f.status);
}

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

export function AirportCheckoutForm({ route, fares, initialDirection, initialDate, initialFlights, coverage, extras, officePickup = null, fromAdmin = false, roundTripHref, startAtFlights = false, initialFlightId, lugaresExtra, locale }: AirportCheckoutFormProps) {
  const privateCheckout = useContext(PrivateAirportContext);
  const router = useRouter();
  const [fullFareCount, setFullFareCount] = useState(1);
  const [customPrice, setCustomPrice] = useState("");
  // Derivación de otra agencia (#109): sólo existe en el alta del panel.
  const [referredBy, setReferredBy] = useState("");
  const [halfFareCount, setHalfFareCount] = useState(0);
  const [freeFareCount, setFreeFareCount] = useState(0);
  const [sportsLuggageCount, setSportsLuggageCount] = useState(0);
  const [useGooglePickup, setUseGooglePickup] = useState(googlePickupConfigured);
  const [manual, setManual] = useState<{ point: PickupPoint; pending: boolean } | null>(null);
  const [pickupAddress, setPickupAddress] = useState("");
  /**
   * Nombre del lugar («Hostal del Esquiador»): es lo que el chofer lee en la orden de servicio.
   * Se propone solo con la sugerencia elegida y el pasajero lo puede corregir (#320).
   */
  const [pickupName, setPickupName] = useState("");
  /** El pasajero escribió el nombre: no se lo pisa con la próxima sugerencia. */
  const [pickupNameTocado, setPickupNameTocado] = useState(false);
  const [pickupPoint, setPickupPoint] = useState<PickupPoint | null>(null);
  const [originalPoint, setOriginalPoint] = useState<PickupPoint | null>(null);
  const [pickupMode, setPickupMode] = useState<"address" | "location">("address");
  const [pickupConfirmed, setPickupConfirmed] = useState(false);
  /** El punto salió del atajo de la sucursal: se guarda con el nombre de la oficina. */
  const [usandoSucursal, setUsandoSucursal] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [approximateAddress, setApproximateAddress] = useState(false);
  const [pickupPrecision, setPickupPrecision] = useState<PickupPrecision | null>(null);
  const [googleReference, setGoogleReference] = useState<{ point: PickupPoint; approximate: boolean } | null>(null);
  const locationRequest = useRef(0);
  useEffect(() => () => {
    locationRequest.current++;
  }, []);
  const [pickupNotes, setPickupNotes] = useState("");
  const [passenger, setPassenger] = useState<PassengerForm>(initialPassenger);
  const [fieldErrors, setFieldErrors] = useState<AirportFieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  // El error tiene que quedar a la vista y el foco ir al campo culpable, no a un cartel lejano.
  useFocusFirstError(fieldErrors, AIRPORT_FIELD_ORDER, formRef);
  const [error, setError] = useState("");
  const { date, sentido, selectedId, selected, setSelectedId, searchBar } = useAirportSearch({
    slug: route.slug, fares, initialDirection, initialDate, initialFlights, initialFlightId, fromAdmin, lugaresExtra,
    roundTripHref: roundTripHref ?? `/reservar/${route.slug}/ida-y-vuelta`, locale
  }, setError);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Vuelo privado: charter o avión particular que no figura en la lista del día. Lo carga el
  // pasajero y queda marcado como "privado" para que la operación lo revise.
  const [esPrivado, setEsPrivado] = useState(false);
  const [privadoNumero, setPrivadoNumero] = useState("");
  const [privadoOperador, setPrivadoOperador] = useState("");
  const [privadoOrigen, setPrivadoOrigen] = useState("");
  const [privadoHora, setPrivadoHora] = useState("");

  const vueloRef = useRef<HTMLDivElement>(null);
  const lugaresRef = useRef<HTMLElement>(null);
  const datosRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  /**
   * Clave del intento de alta (#139): si la respuesta se pierde y el pasajero reintenta, el
   * servidor devuelve la reserva que ya creó en vez de ocupar un segundo lugar. Se renueva
   * cuando cambia el vuelo, el sentido o la fecha, porque eso ya es otro intento.
   */
  const claveDeIdempotencia = useRef("");
  useEffect(() => {
    claveDeIdempotencia.current = "";
  }, [selectedId, date, sentido, esPrivado, privadoNumero, privadoHora]);

  const privadoListo = privadoNumero.trim().length >= 3 && /^\d{2}:\d{2}$/.test(privadoHora);
  const sentidoDelVuelo = esPrivado ? sentido : selected?.direction ?? sentido;
  const normalPickupStart = esPrivado && privadoListo
    ? airportPickupStart({ direction: sentidoDelVuelo, scheduledAt: new Date(`${date}T${privadoHora}:00-03:00`) })
    : selected?.pickupStartAt ? new Date(selected.pickupStartAt) : null;
  const esPaihuen = isPaihuen(pickupName, pickupAddress, pickupPoint);
  const pickupStart = paihuenPickupTime(normalPickupStart, esPaihuen && sentidoDelVuelo === "DEPARTURE");
  const pickupStartLabel = !esPrivado && selected?.pickupStartCoordinated ? "Inicio de recorrida" : "Inicio estimado de recorrida";
  // La tarifa es la de la ruta canónica de ese sentido: la misma que graba la reserva.
  const tarifa = fares[sentidoDelVuelo] ?? null;
  const precioPorPersona = tarifa?.priceCents ?? route.priceCents;
  const moneda = tarifa?.currency ?? route.currency;
  const passengerCount = fullFareCount + halfFareCount + freeFareCount;
  const maxSeats = Math.min(selected?.available ?? 24, 24);
  const overrideTotalCents = fromAdmin && customPrice.trim() ? parseReservationPrice(customPrice) : undefined;
  const ofreceEquipaje = extras.sportsLuggageCents > 0;
  const adicionales = airportExtrasBreakdown(
    { zoneExtra: chargesZoneExtra(pickupPoint, coverage), sportsLuggageCount: ofreceEquipaje ? sportsLuggageCount : 0 },
    extras
  );
  const paihuenCents = esPaihuen && moneda === "ARS" ? passengerCount * PAIHUEN_UNIT_CENTS : 0;
  const total = overrideTotalCents ?? reservationTotalCents(precioPorPersona, fareCounts(passengerCount, halfFareCount, freeFareCount)) + adicionales.totalCents + paihuenCents;
  const puedeSeguir = Boolean(tarifa) && (esPrivado ? privadoListo : Boolean(selected && selected.bookable));

  const outsideCoverage = Boolean(coverage.enabled && pickupPoint && !isInsideAirportPickupZone(pickupPoint, coverage));

  /**
   * El vuelo está listo cuando se puede reservar (tarifa vigente + vuelo de la lista o privado
   * completo). El lugar, cuando hay un punto confirmado y adentro de la cobertura: es el mismo
   * criterio con el que se valida el alta, así los datos no se abren sobre un lugar inválido.
   */
  const lugarListo = Boolean(pickupPoint) && pickupConfirmed && !outsideCoverage;
  const flujo = seccionesDelCheckoutUnTramo({ vueloListo: puedeSeguir, lugarListo });
  const textoDelLugar = textoDelLugarDe(sentidoDelVuelo);

  // Una vez que una sección apareció, se queda: si después cambia un vuelo o el lugar, no se le
  // borra de la pantalla lo que ya estaba cargando (igual que el ida y vuelta).
  const [lugaresAbiertos, setLugaresAbiertos] = useState(false);
  const [datosAbiertos, setDatosAbiertos] = useState(false);
  if (flujo.lugares && !lugaresAbiertos) setLugaresAbiertos(true);
  if (flujo.datos && !datosAbiertos) setDatosAbiertos(true);

  // Al elegir el vuelo, la pantalla baja sola a los lugares (y el foco va al título, para el lector
  // de pantalla). Sólo cuando aparecen, no en cada cambio.
  const vueloListoAntes = useRef(puedeSeguir);
  useEffect(() => {
    if (puedeSeguir && !vueloListoAntes.current) {
      const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // La barra arriba y los lugares justo debajo: no se pierde de vista lo que se eligió (18-nov).
      const barra = lugaresRef.current?.closest("form")?.querySelector<HTMLElement>(".trip-search") ?? lugaresRef.current;
      barra?.scrollIntoView({ behavior: suave ? "smooth" : "auto", block: "start" });
      lugaresRef.current?.querySelector<HTMLElement>("#pickup-flow-titulo")?.focus({ preventScroll: true });
    }
    vueloListoAntes.current = puedeSeguir;
  }, [puedeSeguir]);
  // Y con el lugar confirmado, a los datos del pasajero.
  const lugarListoAntes = useRef(lugarListo);
  useEffect(() => {
    if (lugarListo && !lugarListoAntes.current) {
      const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      datosRef.current?.scrollIntoView({ behavior: suave ? "smooth" : "auto", block: "start" });
      datosRef.current?.querySelector<HTMLElement>("#datos-titulo")?.focus({ preventScroll: true });
    }
    lugarListoAntes.current = lugarListo;
  }, [lugarListo]);
  // El sentido ya viene elegido en el link: se entra directo a la barra del vuelo, una sola vez.
  const entroAlVuelo = useRef(false);
  useEffect(() => {
    if (!startAtFlights || entroAlVuelo.current) return;
    entroAlVuelo.current = true;
    vueloRef.current?.scrollIntoView({ block: "start" });
  }, [startAtFlights]);

  function selectPickupPoint(point: PickupPoint | null) {
    setManual(null);
    setUsandoSucursal(false);
    setApproximateAddress(false);
    setPickupPrecision(point ? "exact" : null);
    setPickupPoint(point);
    setOriginalPoint(point);
    setPickupConfirmed(false);
    setGoogleReference(null);
    setError((current) => current === OUTSIDE_PICKUP_ZONE ? "" : current);
    setFieldErrors((current) => ({ ...current, pickupAddress: undefined }));
  }

  function useCurrentLocation() {
    const request = ++locationRequest.current;
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
    locationRequest.current++;
    setPickupMode("address");
    selectPickupPoint(null);
    setLocating(false);
    setLocationError("");
  }

  /** Atajo de la sucursal: deja el punto y la dirección de la oficina en un toque, ya confirmado. */
  function useOfficePickup() {
    if (!officePickup) return;
    locationRequest.current++;
    setPickupMode("address");
    setLocating(false);
    setLocationError("");
    setPickupAddress(officePickup.address);
    selectPickupPoint(officePickup.point);
    setApproximateAddress(false);
    setPickupPrecision("exact");
    setPickupConfirmed(true);
    setUsandoSucursal(true);
  }

  function markPickupPoint(point: PickupPoint) {
    locationRequest.current++;
    setLocating(false);
    setLocationError("");
    setGoogleReference(null);
    setUsandoSucursal(false);
    if (!adjustPickupPoint(point)) selectPickupPoint(point);
    setPickupMode("address");
    setPickupAddress("");
    setApproximateAddress(false);
    setPickupPrecision("exact");
    setManual({ point, pending: true });
  }

  function selectSearchPlace(place: AirportSelectedPlace) {
    locationRequest.current++;
    setLocating(false);
    setLocationError("");
    const google = place.source === "google";
    setPickupAddress(google ? "" : place.label.slice(0, 160));
    // El nombre del lugar sale de la sugerencia (si es un lugar, no una calle) mientras el pasajero
    // no lo haya escrito él mismo: es el dato que va a la orden del chofer (#320).
    if (!pickupNameTocado) setPickupName(nombreDelLugarSugerido(place));
    selectPickupPoint(google ? null : place.point);
    setApproximateAddress(place.approximate);
    setPickupPrecision(place.precision);
    if (google && place.point) setGoogleReference({ point: place.point, approximate: place.approximate });
  }

  function adjustPickupPoint(point: PickupPoint) {
    if (!originalPoint) return false;
    setUsandoSucursal(false);
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

  /** Muestra el problema arriba del formulario y lo deja a la vista (puede estar lejos de donde está la persona). */
  function mostrarProblema(problema: string) {
    setError(problema);
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  /** El botón del resumen antes de tener todo: dice qué falta y lleva a esa sección. */
  function avanzar() {
    if (!puedeSeguir) {
      mostrarProblema(esPrivado
        ? "Completá el número o matrícula y la hora de tu vuelo privado."
        : "Elegí tu vuelo en la barra de arriba.");
      vueloRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    mostrarProblema(outsideCoverage ? OUTSIDE_PICKUP_ZONE : "Confirmá que el punto marcado sea el lugar correcto.");
    lugaresRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    // El traslado al aeropuerto no exige documento (17-nov) ni email (18-nov): nombre y teléfono alcanzan.
    const errors: Record<string, string> = { ...validateCheckoutPassenger(passenger, true, true) };
    if (overrideTotalCents === null) errors.customPrice = reservationPriceError;
    if (esPrivado) {
      if (!privadoListo) errors.flight = "Completá el número o matrícula y la hora de tu vuelo privado.";
    } else if (!selected) {
      errors.flight = "Elegí tu vuelo en la barra de arriba.";
    } else if (!selected.bookable) {
      errors.flight = selected.reason ?? "Ese vuelo no se puede reservar.";
    }
    if (!esPrivado && selected && passengerCount > selected.available) {
      errors.passengerCount = `Sólo quedan ${selected.available} lugares en ese vuelo.`;
    }
    if (outsideCoverage) {
      errors.pickupAddress = OUTSIDE_PICKUP_ZONE;
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
      // Una clave por intento: si el alta llegó al servidor y la respuesta no, el reintento con la
      // misma clave devuelve la reserva existente en vez de crear otra (#139).
      claveDeIdempotencia.current ||= nuevaClaveDeIdempotencia();
      const res = await fetch(fromAdmin ? "/api/v1/airport/reservations?source=admin" : "/api/v1/airport/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: claveDeIdempotencia.current,
          routeSlug: route.slug,
          flightNumber: esPrivado ? privadoNumero.trim().toUpperCase() : selected!.number,
          direction: esPrivado ? sentido : selected!.direction,
          serviceDate: date,
          passengerCount,
          halfFareCount,
          freeFareCount,
          sportsLuggageCount: adicionales.sportsLuggageCount,
          overrideTotalCents,
          referredBy: fromAdmin ? referredBy.trim() || undefined : undefined,
          passenger: buildPassengerPayload(passenger),
          pickupAddress: pickupMode === "location" ? undefined : pickupAddress.trim() || undefined,
          pickupName: pickupNameParaElChofer({ usandoSucursal, sucursalLabel: officePickup?.label, escrito: pickupName }),
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

  if (privateCheckout) {
    return privateCheckout.renderForm(searchBar(), [{
      date, direction: sentido, flight: selected?.privateBookable ? selected : null, clearFlight: () => setSelectedId("")
    }], error);
  }

  return (
    <form className="checkout-layout" onSubmit={handleSubmit} ref={formRef} noValidate>
      <div className="checkout-main">
        <section className="form-panel checkout-panel">
          {/* Indicador de por dónde va: se completa solo, no hay que tocarlo. */}
          <ol className="wizard-steps checkout-progress" aria-label="Pasos de la reserva">
            {flujo.etapas.map((titulo, i) => {
              const activa = flujo.activa === i;
              return (
                <li key={titulo} data-active={activa} data-done={flujo.hechas[i]} aria-current={activa ? "step" : undefined}>
                  <span>{flujo.hechas[i] ? "✓" : i + 1}</span>
                  {fromAdmin && i === 2 ? "Datos del pasajero" : titulo}
                </li>
              );
            })}
          </ol>

          <FormErrorSummary fieldErrors={fieldErrors} order={AIRPORT_FIELD_ORDER} />
          {error ? <p className="error" role="alert" ref={errorRef}>{error} {error === OUTSIDE_PICKUP_ZONE ? <a href="https://wa.me/5492944649049" target="_blank" rel="noreferrer">Consultar por WhatsApp ↗</a> : null}</p> : null}

          <div ref={vueloRef}>
            <p className="eyebrow">Tu vuelo</p>
            <h2 className="route-title">{sentido === "ARRIVAL" ? "Llegada a Chapelco" : "Salida desde San Martín"}</h2>
            <p className="muted">
              Tocá cada recuadro para elegir: desde dónde sale, adónde va, y el día y el vuelo. Con ⇄ pasás
              de llegada a salida, y con «Agregar vuelta» sumás el regreso.
            </p>
          </div>

          {/* El mismo recuadro que el ida y vuelta (pedido de Jugue, 18-nov): Desde ⇄ Hacia cambia
              entre llegada y salida, y al lado de la fecha está la vuelta, apagada, para sumarla. */}
          {searchBar(() => {
            useAddress();
            setPickupAddress("");
            setEsPrivado(false);
          }, () => setEsPrivado(false))}
          {fieldErrors.flight ? <p className="field-error" role="alert">{fieldErrors.flight}</p> : null}


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

          {/* Con el vuelo elegido aparecen los lugares, sin apretar «Continuar». */}
          {lugaresAbiertos ? (
            <section className="pickup-flow" ref={lugaresRef} aria-labelledby="pickup-flow-titulo">
              {/* Sin encabezado a la vista (pedido de Jugue, 18-nov): así la barra de los vuelos sigue en pantalla.
                  El título queda para el lector de pantalla y para llevarle el foco. */}
              <h2 className="sr-only" id="pickup-flow-titulo" tabIndex={-1}>{textoDelLugar.titulo}</h2>

              <section className="leg-card" data-done={lugarListo}>
                <header className="leg-head">
                  <span className="leg-badge" aria-hidden="true">1</span>
                  <div className="leg-head-text">
                    <span className="leg-kicker">{sentidoDelVuelo === "ARRIVAL" ? "Llegada" : "Salida"}</span>
                    <h3 className="leg-title">{textoDelLugar.lugar}</h3>
                  </div>
                  {lugarListo ? <span className="leg-check" aria-label="Lugar confirmado">✓</span> : null}
                </header>

                {/* Los atajos primero, en botones grandes; escribir la dirección queda como tercera opción. */}
                <div className="place-shortcuts">
                  <button type="button" className="place-shortcut" disabled={locating || isSubmitting}
                    aria-pressed={Boolean(pickupPoint) && pickupMode === "location"} onClick={useCurrentLocation}>
                    <span className="place-shortcut-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" /><circle cx="12" cy="12" r="7.5" /><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" /></svg>
                    </span>
                    <span className="place-shortcut-text">
                      <b>{locating ? "Buscando dónde estás…" : "Usar mi ubicación actual"}</b>
                      <small>Si ya estás en el lugar</small>
                    </span>
                  </button>
                  {officePickup ? (
                    <button type="button" className="place-shortcut" disabled={isSubmitting}
                      aria-pressed={usandoSucursal} onClick={useOfficePickup}>
                      <span className="place-shortcut-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24"><path d="M4 21V9l8-5 8 5v12" /><path d="M9 21v-6h6v6M3 21h18" /></svg>
                      </span>
                      <span className="place-shortcut-text">
                        <b>{sentidoDelVuelo === "ARRIVAL" ? `Ir a ${officePickup.label}` : `Salir desde ${officePickup.label}`}</b>
                        <small>{officePickup.address}</small>
                      </span>
                    </button>
                  ) : null}
                </div>
                {locationError ? <p role="alert" className="field-error">{locationError}</p> : null}

                {pickupMode === "address" ? (
                  <>
                    <p className="place-or">o escribí la dirección:</p>
                    <AirportPlaceSearch coverage={coverage} useGoogle={useGooglePickup} disabled={isSubmitting}
                      onSelect={selectSearchPlace} onChange={() => {
                        setPickupAddress("");
                        selectPickupPoint(null);
                      }} />
                  </>
                ) : (
                  <button className="ghost-button" type="button" onClick={useAddress}>Buscar por dirección</button>
                )}
                {pickupMode === "address" && pickupAddress && !pickupPoint ? (
                  <p className="muted" role="status">
                    Dirección cargada: <strong>{pickupAddress}</strong>. Marcá en el mapa dónde está para fijar el punto.
                  </p>
                ) : null}
                {fieldErrors.pickupAddress && !outsideCoverage ? <p className="field-error" role="alert">{fieldErrors.pickupAddress}</p> : null}
                {useGooglePickup ? (
                  <AirportGooglePickup
                    coverage={coverage}
                    point={pickupPoint}
                    reference={googleReference}
                    approximate={approximateAddress}
                    disabled={isSubmitting}
                    onPoint={markPickupPoint}
                    onUnavailable={() => setUseGooglePickup(false)}
                  />
                ) : (
                  <AirportDraggableMap point={pickupPoint} approximate={approximateAddress} precision={pickupPrecision} disabled={isSubmitting} onMove={(point) => { markPickupPoint(point); return true; }} onSelect={markPickupPoint} />
                )}
                {manual && manual.point === pickupPoint ? <MapPointAddress point={manual.point} onResult={(address) => {
                  setPickupAddress(address);
                  setManual({ point: manual.point, pending: false });
                }} /> : null}
                {coverage.enabled && pickupPoint ? (
                  <p className={outsideCoverage ? "field-error" : "muted"} role="status">
                    {outsideCoverage ? (
                      <>{OUTSIDE_PICKUP_ZONE} <a href="https://wa.me/5492944649049" target="_blank" rel="noreferrer">Consultar por WhatsApp ↗</a></>
                    ) : adicionales.zoneExtraCents > 0
                      ? `El punto marcado está en la zona con recargo: se suman ${formatPrice(adicionales.zoneExtraCents, moneda)} a la reserva.`
                      : "El punto marcado está dentro de la cobertura."}
                  </p>
                ) : null}
                {pickupPoint && originalPoint && pickupPoint !== originalPoint ? (
                  <button type="button" className="ghost-button" disabled={isSubmitting} onClick={() => markPickupPoint(originalPoint)}>Volver al punto original</button>
                ) : null}
                {pickupPoint && !outsideCoverage ? (
                  <label>
                    <input type="checkbox" checked={pickupConfirmed} disabled={isSubmitting || manual?.pending} onChange={(event) => {
                      setPickupConfirmed(event.target.checked);
                      setFieldErrors((current) => ({ ...current, pickupAddress: undefined }));
                    }} /> Confirmo que el mapa marca el lugar correcto
                  </label>
                ) : null}
                {pickupMode === "address" && (pickupPoint || pickupAddress) ? (
                  <label>Dirección o referencia para el chofer (opcional)
                    <input name="pickupAddress" autoComplete="street-address" maxLength={160} value={pickupAddress}
                      disabled={isSubmitting} onChange={(event) => { setManual(null); setPickupAddress(event.target.value); }} />
                  </label>
                ) : null}
                {/* El nombre del lugar es lo que el chofer busca en la calle; la dirección sola no
                    siempre alcanza (issue #320). Con el atajo de la sucursal ya viene el de la oficina. */}
                {!usandoSucursal && (pickupPoint || pickupAddress) ? (
                  <label>Nombre del lugar (opcional)
                    <input name="pickupName" maxLength={120} value={pickupName} placeholder="Ej.: Hostal del Esquiador"
                      disabled={isSubmitting} onChange={(event) => {
                        setPickupName(event.target.value);
                        setPickupNameTocado(true);
                      }} />
                  </label>
                ) : null}
                <label>Notas (opcional)<input name="pickupNotes" value={pickupNotes} onChange={(e) => setPickupNotes(e.target.value)} /></label>
              </section>
            </section>
          ) : null}

          {/* Con el lugar confirmado aparecen los datos del pasajero, sin apretar «Continuar». */}
          {datosAbiertos ? (
            <section className="pickup-flow" ref={datosRef} aria-labelledby="datos-titulo">
              <div>
                <p className="eyebrow">Tus datos</p>
                <h2 className="route-title" id="datos-titulo" tabIndex={-1}>{fromAdmin ? "Datos del pasajero" : "¿Quiénes viajan?"}</h2>
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
                  <p className="muted">{esPaihuen ? "Te buscamos en Paihuén, la primera parada del recorrido." : AIRPORT_PICKUP_COPY}</p>
                </div>
              ) : null}
              <PassengerFields
                passenger={passenger}
                fieldErrors={fieldErrors}
                optionalIdentity
                optionalDocument
                disabled={isSubmitting}
                onChange={updatePassenger}
              />
              <div className="checkout-fields">
                <QuantityPicker
                  label="Pasajeros con tarifa completa"
                  value={fullFareCount}
                  min={1}
                  max={maxSeats - halfFareCount}
                  disabled={isSubmitting}
                  onChange={setFullFareCount}
                />
                <QuantityPicker
                  label="Menores de 4 a 8 años · media tarifa"
                  value={halfFareCount}
                  min={0}
                  max={maxSeats - fullFareCount - freeFareCount}
                  disabled={isSubmitting}
                  onChange={setHalfFareCount}
                />
                <QuantityPicker
                  label="Menores de 4 años · sin cargo"
                  value={freeFareCount}
                  min={0}
                  max={maxSeats - fullFareCount - halfFareCount}
                  disabled={isSubmitting}
                  onChange={setFreeFareCount}
                />
                <p className="muted" style={{ gridColumn: "1 / -1" }}>
                  Lugares a reservar: {passengerCount}{selected ? ` de ${selected.available} disponibles` : ""}.<br />
                  De 4 a 8 años inclusive pagan media tarifa. Los menores de 4 no pagan, pero ocupan un lugar:
                  contalos como un lugar más del vehículo.
                </p>
                {ofreceEquipaje ? (
                  <>
                    <QuantityPicker
                      label={`Equipaje deportivo · ${formatPrice(extras.sportsLuggageCents, moneda)} por bulto`}
                      value={sportsLuggageCount}
                      min={0}
                      max={MAX_SPORTS_LUGGAGE}
                      disabled={isSubmitting}
                      onChange={setSportsLuggageCount}
                    />
                    <p className="muted" style={{ gridColumn: "1 / -1" }}>
                      Esquíes, tablas de snowboard, bicicletas u otro equipo deportivo: contá cada funda o bulto por separado.
                    </p>
                  </>
                ) : null}
              </div>

              {fromAdmin ? (
                <div className="checkout-fields">
                  <label>
                    Precio total de la reserva ({moneda}, opcional)
                    <input inputMode="decimal" value={customPrice} onChange={(event) => setCustomPrice(event.target.value)}
                      placeholder="Usar tarifa automática" disabled={isSubmitting} aria-invalid={Boolean(fieldErrors.customPrice)} />
                    {fieldErrors.customPrice ? <span className="field-error" role="alert">{fieldErrors.customPrice}</span> : null}
                  </label>
                  <label>
                    Derivado por (opcional)
                    <input maxLength={120} value={referredBy} onChange={(event) => setReferredBy(event.target.value)}
                      placeholder="Ej. una agencia de viajes" disabled={isSubmitting} />
                    <small>Quién vendió la reserva. Sale en la columna «Derivado por» de la orden de servicio del chofer.</small>
                  </label>
                </div>
              ) : null}

              <button className="button pickup-flow-next" type="submit" disabled={isSubmitting || !puedeSeguir || outsideCoverage}>
                {isSubmitting ? "Reservando…" : "Reservar"}
              </button>
            </section>
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
          {halfFareCount > 0 ? <span>Menores con media tarifa: <strong>{halfFareCount}{overrideTotalCents == null ? ` · ${formatPrice(halfFareCents(precioPorPersona), moneda)} cada uno` : ""}</strong></span> : null}
          {freeFareCount > 0 ? <span>Menores de 4 sin cargo: <strong>{freeFareCount}</strong></span> : null}
          {overrideTotalCents == null ? <span>Tarifa: <strong>{formatPrice(precioPorPersona, moneda)} por persona</strong></span> : <span>Precio total ajustado por administración</span>}
          {adicionales.sportsLuggageCount > 0 ? <span>Equipaje deportivo: <strong>{adicionales.sportsLuggageCount}{overrideTotalCents == null ? ` · ${formatPrice(adicionales.sportsLuggageTotalCents, moneda)}` : ""}</strong></span> : null}
          {paihuenCents > 0 && overrideTotalCents == null ? <span>Adicional Paihuén ({passengerCount} × $13.000): <strong>{formatPrice(paihuenCents, moneda)}</strong></span> : null}
          {adicionales.zoneExtraCents > 0 && overrideTotalCents == null ? <span>Recargo por zona: <strong>{formatPrice(adicionales.zoneExtraCents, moneda)}</strong></span> : null}
        </div>
        <strong className="price">{formatPrice(total, moneda)}</strong>
        {!lugarListo ? (
          <button className="button checkout-submit" type="button" onClick={avanzar}>
            {puedeSeguir ? "Falta elegir el lugar" : "Elegí tu vuelo"}
          </button>
        ) : (
          <button className="button checkout-submit" type="submit" disabled={isSubmitting || !puedeSeguir || outsideCoverage}>
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
