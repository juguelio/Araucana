"use client";

import Link from "next/link";
import { PrivateAirportContext } from "./private-airport-context";
import { useContext, useMemo, useRef, useState } from "react";
import { separarVuelosDelSelector } from "@/lib/airport/flight-selector";
import { detalleDeLaVuelta, hrefConViaje } from "./airport-trip-options";
import { TripSearchBar, type TramoDeLaBarra, type Sentido } from "./ida-y-vuelta/trip-search-bar";
import type { Locale } from "@/i18n/config";

export type FlightOption = {
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
  /** Procedencia de la programación o de la lectura operativa. */
  source?: string;
  available: number;
  bookable: boolean;
  privateBookable?: boolean;
  reason: string | null;
};

type Fares = Record<Sentido, { priceCents: number; currency: string } | null>;
type SearchProps = {
  slug: string; fares: Fares; initialDirection: Sentido; initialDate: string;
  initialFlights?: FlightOption[]; initialFlightId?: string; fromAdmin?: boolean;
  lugaresExtra?: React.ComponentProps<typeof TripSearchBar>["lugaresExtra"]; roundTripHref: string; locale?: Locale;
};

export function useAirportSearch({ slug, fares, initialDirection, initialDate, initialFlights, initialFlightId,
  fromAdmin, lugaresExtra, roundTripHref, locale }: SearchProps, setError: (message: string) => void) {
  const privada = useContext(PrivateAirportContext);
  const esPrivada = Boolean(privada);
  const [date, setDate] = useState(initialDate);
  const [flights, setFlights] = useState<FlightOption[]>(initialFlights ?? []);
  const [sentido, setSentido] = useState<"ARRIVAL" | "DEPARTURE">(
    // Si el sentido con el que entra la página no tiene tarifa activa, se arranca por el otro.
    fares[initialDirection] ? initialDirection : fares.DEPARTURE ? "DEPARTURE" : "ARRIVAL"
  );
  const [selectedId, setSelectedId] = useState<string>(
    // Al volver del ida y vuelta se conserva el vuelo de ese sentido, si sigue en la lista del día.
    () => initialFlights?.find((vuelo) => vuelo.id === initialFlightId && vuelo.direction === initialDirection)?.id ?? ""
  );
  const [cargandoVuelos, setCargandoVuelos] = useState(false);
  const loaded = useRef(initialFlights !== undefined);
  const flightRequest = useRef(0);
  async function cargarVuelos(fecha: string) {
    const request = ++flightRequest.current;
    loaded.current = true;
    setFlights([]);
    setCargandoVuelos(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/airport/flights?slug=${encodeURIComponent(slug)}&date=${fecha}`);
      const data = await res.json();
      if (request !== flightRequest.current) return;
      if (!res.ok) {
        setFlights([]);
        loaded.current = false;
        setError(data?.error?.message ?? "No pudimos traer los vuelos de ese día.");
      } else {
        setFlights(data.flights ?? []);
        setSelectedId("");
      }
    } catch {
      if (request !== flightRequest.current) return;
      setFlights([]);
      loaded.current = false;
      setError("No pudimos traer los vuelos de ese día. Probá de nuevo.");
    }
    setCargandoVuelos(false);
  }

  const { reservables } = useMemo(
    () => separarVuelosDelSelector(flights, sentido, esPrivada),
    [flights, sentido, esPrivada]
  );
  const selected = useMemo(() => flights.find((f) => f.id === selectedId) ?? null, [flights, selectedId]);

  const tramoDeLaBarra: TramoDeLaBarra = {
    sentido,
    // Igual que el primer casillero del ida y vuelta: «Ida · Llegada» / «Ida · Salida».
    etapa: "Ida",
    titulo: sentido === "ARRIVAL" ? "Llegada a Chapelco" : esPrivada ? "Salida desde Chapelco" : "Salida desde San Martín",
    pregunta: sentido === "ARRIVAL"
      ? "¿Qué día aterriza en Chapelco y en qué vuelo?"
      : "¿Qué día se va y en qué vuelo? Lo buscamos antes para llegar a tiempo.",
    fecha: date,
    minimo: fromAdmin ? "" : new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10),
    opciones: reservables,
    elegido: selectedId,
    cargando: cargandoVuelos
  };

  function searchBar(onDirection?: () => void, onSelect?: () => void) {
    const detalle = detalleDeLaVuelta(sentido, fares);
    return (
      <TripSearchBar locale={locale} tramos={[tramoDeLaBarra]} routeSlug={slug} lugaresExtra={esPrivada ? undefined : lugaresExtra} privatePlace={privada?.place}
        onAbrirVuelos={() => { if (!loaded.current) void cargarVuelos(date); }}
        onPedirOrden={esPrivada && !fares[sentido === "ARRIVAL" ? "DEPARTURE" : "ARRIVAL"] ? undefined : (nuevo) => {
          if (nuevo === sentido || !fares[nuevo]) return;
          setSentido(nuevo);
          setSelectedId("");
          setError("");
          onDirection?.();
        }}
        onFecha={(_, fecha) => { setDate(fecha); setSelectedId(""); void cargarVuelos(fecha); }}
        onVuelo={(_, id) => { setSelectedId(id); setError(""); onSelect?.(); }}
        agregarVuelta={detalle === null ? undefined : {
          href: hrefConViaje(roundTripHref, {date, sentido, vuelo: selectedId || undefined}) + "&abrir=vuelta", detalle: esPrivada ? undefined : detalle
        }}
      />
    );
  }
  return {date, sentido, selectedId, selected, setSelectedId, searchBar};
}

export function AirportSearch(props: SearchProps & { checkoutHref: string; continueLabel: string }) {
  const [error, setError] = useState("");
  const {date, sentido, selectedId, searchBar} = useAirportSearch(props, setError);
  return (
    <div className="public-trip-search">
      {searchBar()}
      {error && <p role="alert">{error}</p>}
      <Link className="button" href={hrefConViaje(props.checkoutHref, {date, sentido, vuelo: selectedId || undefined})}>
        {props.continueLabel}
      </Link>
    </div>
  );
}
