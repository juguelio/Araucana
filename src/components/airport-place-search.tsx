"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { searchGoogleAirportPlaces, type GoogleSuggestion } from "@/lib/airport/google-place-search";
import { isInsideAirportPickupZone, type AirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import {
  isIntersectionQuery, prioritizeLocalPlaces, splitPlaceQuery, splitStreetAddress
} from "@/lib/airport/place-search-area";
import type { AirportPlaceSuggestion, PickupPrecision } from "@/lib/airport/place-suggestions";
import type { StreetOption } from "@/lib/airport/street-address";
import { catalogueLodgings, municipalLodgingsSource, suggestMunicipalLodgings, withMunicipalLodgings } from "@/lib/airport/lodging-catalogue";
import styles from "./airport-address-map.module.css";

type Suggestion = AirportPlaceSuggestion | GoogleSuggestion;
export type AirportSelectedPlace = {
  label: string;
  point: PickupPoint | null;
  approximate: boolean;
  precision: PickupPrecision;
  source: Suggestion["source"];
};

const googleAreaTypes = new Set(["locality", "sublocality", "neighborhood", "route", "administrative_area_level_3"]);
const googleAddressTypes = new Set(["street_address", "premise", "subpremise"]);
const heightPattern = /^\d{1,5}[a-z]?$/i;

async function searchLocal(address: string, signal: AbortSignal): Promise<AirportPlaceSuggestion[]> {
  const response = await fetch("/api/v1/airport/address", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "suggestions", address }),
    signal
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message);
  return data.matches;
}

/** Calles del nomenclador municipal: desambigua homónimas (Bertha y Av. Koessler). */
async function searchStreets(query: string, signal: AbortSignal): Promise<StreetOption[]> {
  const response = await fetch("/api/v1/airport/address", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "streets", address: query }),
    signal
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message);
  return data.streets;
}

async function searchStreetAddress(street: string, number: string, signal: AbortSignal): Promise<AirportPlaceSuggestion | null> {
  const response = await fetch("/api/v1/airport/address", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "street-address", address: street, number }),
    signal
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message);
  return data.match;
}

type AttributionSource = Suggestion["source"] | "provincial";

function attributionSource(suggestion: Suggestion): AttributionSource {
  return suggestion.source === "municipal" && suggestion.lodgingId?.startsWith("nqn-")
    ? "provincial"
    : suggestion.source;
}

function SearchAttribution({ sources }: { sources: AttributionSource[] }) {
  return (
    <p className="muted">
      {sources.includes("google") ? <span translate="no">Google Maps </span> : null}
      {sources.includes("municipal") ? <><a href={municipalLodgingsSource} target="_blank" rel="noreferrer">Turismo San Martín de los Andes</a>{" · "}</> : null}
      {sources.includes("provincial") ? <a href="https://turismo.neuquen.gob.ar/alojamientos/" target="_blank" rel="noreferrer">Turismo Neuquén</a> : null}
      {sources.includes("georef") ? <a href="https://www.argentina.gob.ar/georef" target="_blank" rel="noreferrer">GeoRef Argentina</a> : null}
      {sources.includes("locationiq") ? <><a href="https://locationiq.com" target="_blank" rel="noreferrer">LocationIQ</a>{" · "}</> : null}
      {sources.some((source) => source === "locationiq" || source === "photon") ? (
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
      ) : null}
    </p>
  );
}

function SuggestionLabel({ suggestion }: { suggestion: Suggestion }) {
  const lodging = suggestion.source === "municipal" && catalogueLodgings.find((entry) => entry.id === suggestion.lodgingId);
  return lodging ? <><strong>{lodging.name}</strong><small>{lodging.address}</small><small>{lodging.type} · {lodging.zone}</small></> : <>{suggestion.label}</>;
}

type AirportPlaceSearchProps = {
  coverage: AirportCoverage;
  useGoogle: boolean;
  disabled: boolean;
  onChange: () => void;
  onSelect: (place: AirportSelectedPlace) => void;
  /**
   * Carga lo escrito como domicilio sin coordenadas (#268), para el alojamiento que el geocoder no
   * encuentra. Sólo lo pasa el panel: el checkout del pasajero sigue exigiendo el punto.
   */
  onUseText?: (text: string) => void;
};

export function AirportPlaceSearch({ coverage, useGoogle, disabled, onChange, onSelect, onUseText }: AirportPlaceSearchProps) {
  const inputId = useId();
  const listId = `${inputId}-options`;
  const streetListId = `${inputId}-streets`;
  const token = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const selectionVersion = useRef(0);
  const selectionRequest = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectionSource, setSelectionSource] = useState<AttributionSource | null>(null);
  const [coordinateSourceUrl, setCoordinateSourceUrl] = useState<string | null>(null);
  const [coordinateSource, setCoordinateSource] = useState<Suggestion["source"] | null>(null);
  const [selectionMessage, setSelectionMessage] = useState("");
  const [locatingLodging, setLocatingLodging] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const [searching, setSearching] = useState(false);
  const [emptySearch, setEmptySearch] = useState(false);
  const [error, setError] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [streetTerm, setStreetTerm] = useState("");
  const [streets, setStreets] = useState<StreetOption[]>([]);
  const [street, setStreet] = useState<StreetOption | null>(null);
  const [height, setHeight] = useState("");
  const [manualError, setManualError] = useState("");
  const [resolving, setResolving] = useState(false);
  const open = focused && suggestions.length > 0;

  useEffect(() => () => { selectionVersion.current++; selectionRequest.current?.abort(); }, []);

  useEffect(() => {
    if (searchTerm.trim().length < 3) return;
    const controller = new AbortController();
    const { signal } = controller;
    // El catálogo está disponible de inmediato, aunque el proveedor tarde o falle.
    const municipal = suggestMunicipalLodgings(searchTerm);
    setSuggestions(municipal);
    const timer = setTimeout(async () => {
      try {
        const address = searchTerm.trim();
        let results: Suggestion[];
        if (!useGoogle || isIntersectionQuery(address)) {
          results = await searchLocal(address, signal);
        } else {
          const { name, context } = splitPlaceQuery(address);
          const numberedAddress = splitStreetAddress(name);
          let googleResults: GoogleSuggestion[] = [];
          try {
            googleResults = await searchGoogleAirportPlaces(address, token, signal);
          } catch {
            token.current = null;
          }
          if (signal.aborted) return;
          if (!context) googleResults = prioritizeLocalPlaces(googleResults, (place) => place.label);
          if (numberedAddress && googleResults.length) {
            const addresses = googleResults.filter(({ types }) => types.some((type) => googleAddressTypes.has(type)));
            if (addresses.length) {
              results = addresses;
            } else {
              results = await searchLocal(address, signal);
            }
          } else {
            results = googleResults.length ? googleResults : await searchLocal(address, signal);
          }
        }
        if (signal.aborted) return;
        const combined = withMunicipalLodgings(address, results);
        setSuggestions(combined);
        setActiveIndex(-1);
        setEmptySearch(combined.length === 0);
        if (combined.length === 0) setError("No encontramos coincidencias. Probá otro nombre, elegí la calle y la altura, o marcá el punto en el mapa.");
      } catch {
        if (!signal.aborted && !municipal.length) setError("No pudimos buscar lugares. Podés marcar el punto en el mapa.");
      } finally {
        if (!signal.aborted) setSearching(false);
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchTerm, useGoogle]);

  useEffect(() => {
    if (!manualOpen) return;
    const term = streetTerm.trim();
    if (term.length < 2) {
      setStreets([]);
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(async () => {
      try {
        const options = await searchStreets(term, signal);
        if (!signal.aborted) setStreets(options);
      } catch {
        if (!signal.aborted) setStreets([]);
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [manualOpen, streetTerm]);

  async function useStreetAddress() {
    if (!street) return;
    const version = ++selectionVersion.current;
    selectionRequest.current?.abort();
    setLocatingLodging(false);
    setSelectionMessage("");
    setCoordinateSource(null);
    setCoordinateSourceUrl(null);
    setResolving(true);
    setManualError("");
    try {
      const match = await searchStreetAddress(street.name, height.trim(), new AbortController().signal);
      if (version !== selectionVersion.current) return;
      if (!match) {
        setManualError("No pudimos resolver esa altura. Revisá el número o marcá el punto en el mapa.");
        return;
      }
      setQuery(match.label);
      setSelectionSource(match.source);
      setEmptySearch(false);
      setStreets([]);
      setManualOpen(false);
      onSelect(match);
    } catch {
      setManualError("No pudimos buscar esa dirección. Probá de nuevo o marcá el punto en el mapa.");
    } finally {
      setResolving(false);
    }
  }

  async function choose(suggestion: Suggestion) {
    const version = ++selectionVersion.current;
    selectionRequest.current?.abort();
    setCoordinateSource(null);
    setCoordinateSourceUrl(null);
    setSelectionMessage("");
    setLocatingLodging(false);
    setQuery(suggestion.label);
    setSearchTerm("");
    setSuggestions([]);
    setActiveIndex(-1);
    setError("");
    setEmptySearch(false);
    setSelectionSource(attributionSource(suggestion));

    token.current = null;
    if (suggestion.source === "municipal" && suggestion.lodgingId) {
      const controller = new AbortController();
      selectionRequest.current = controller;
      setSearching(false);
      setLocatingLodging(true);
      let selected = suggestion;
      try {
        if (!suggestion.point) {
          const response = await fetch("/api/v1/airport/address", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "lodging", id: suggestion.lodgingId }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
          });
          if (response.ok) {
            const data = await response.json();
            if (data.match?.lodgingId === suggestion.lodgingId) selected = data.match;
          }
        }
      } catch { /* Conserva el alojamiento aunque no se pueda ubicar su domicilio. */ }
      if (version !== selectionVersion.current) return;
      setLocatingLodging(false);
      setCoordinateSource(selected.coordinateSource ?? null);
      setCoordinateSourceUrl(selected.coordinateSourceUrl ?? null);
      setSelectionMessage(selected.point
        ? selected.precision === "street"
          ? "Ubicamos la zona de referencia. Ajustá el marcador hasta la entrada exacta del alojamiento."
          : selected.locationMatch === "establishment"
          ? "Encontramos el alojamiento. Confirmá en el mapa dónde está la entrada."
          : "Ubicamos la dirección. Confirmá en el mapa que el punto corresponde a la entrada del alojamiento."
        : "Conservamos el alojamiento y su dirección. Marcá en el mapa dónde está la entrada.");
      onSelect(selected);
      return;
    }
    if (suggestion.source !== "google") {
      setSearching(false);
      onSelect(suggestion);
      return;
    }

    setSearching(true);
    try {
      const place = suggestion.toPlace();
      await place.fetchFields({ fields: ["location"] });
      if (version !== selectionVersion.current) return;
      if (!place.location) throw new Error("Missing location");
      const coarse = suggestion.types.some((type) => googleAreaTypes.has(type));
      onSelect({
        source: "google",
        label: suggestion.label,
        point: [place.location.lat(), place.location.lng()],
        approximate: coarse,
        precision: coarse ? "interpolated" : "exact"
      });
    } catch {
      if (version === selectionVersion.current) {
        setError("No pudimos ubicar esa opción. Probá otra búsqueda o marcá el punto en el mapa.");
      }
    } finally {
      if (version === selectionVersion.current) setSearching(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      const selected = open ? suggestions[activeIndex < 0 ? 0 : activeIndex] : undefined;
      if (selected) void choose(selected);
    }
    if (event.key === "Escape") setFocused(false);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!suggestions.length) return;
      event.preventDefault();
      setFocused(true);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => index < 0
        ? (direction === 1 ? 0 : suggestions.length - 1)
        : (index + direction + suggestions.length) % suggestions.length);
    }
  }

  return (
    <div className={styles.search}>
      <label htmlFor={inputId}>Hotel, cabaña o dirección</label>
      <input id={inputId} type="text" role="combobox" aria-autocomplete="list" autoComplete="off"
        aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        placeholder="Ej. Hotel del Esquiador o San Martín y Belgrano" value={query} maxLength={160} disabled={disabled}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        onChange={(event) => {
          selectionVersion.current++;
          selectionRequest.current?.abort();
          setLocatingLodging(false);
          setSelectionMessage("");
          setCoordinateSource(null);
          setCoordinateSourceUrl(null);
          const value = event.target.value;
          if (!value.trim()) token.current = null;
          setQuery(value);
          setSearchTerm(value);
          setFocused(true);
          setSearching(value.trim().length >= 3);
          setSuggestions([]);
          setActiveIndex(-1);
          setSelectionSource(null);
          setError("");
          setEmptySearch(false);
          onChange();
        }} />
      {searching ? <p className="muted" role="status">Buscando lugares…</p> : null}
      {locatingLodging ? <p className="muted" role="status">Ubicando la dirección del alojamiento…</p> : null}
      {selectionMessage ? <p className="muted" role="status">{selectionMessage}</p> : null}
      {error ? <p className="muted" role="status">{error}</p> : null}
      {/* El nombre del alojamiento no está en ningún geocoder: se carga tal cual, sin punto (#268). */}
      {onUseText && emptySearch && !searching && query.trim().length >= 3 ? (
        <button type="button" className={styles.manualToggle} disabled={disabled}
          onClick={() => {
            const text = query.trim();
            setSearchTerm("");
            setSuggestions([]);
            setActiveIndex(-1);
            setError("");
            setEmptySearch(false);
            setSelectionSource(null);
            setFocused(false);
            onUseText(text);
          }}>
          Usar «{query.trim()}» como domicilio, sin punto en el mapa
        </button>
      ) : null}
      {open ? (
        <>
          <ul id={listId} role="listbox" aria-label="Sugerencias de lugares" className={styles.suggestions}>
            {suggestions.map((suggestion, index) => (
              <li key={suggestion.source === "google" ? suggestion.placeId : `${suggestion.label}:${suggestion.point ?? "sin-punto"}`}
                id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { if (!disabled) void choose(suggestion); }}>
                <SuggestionLabel suggestion={suggestion} />
                {suggestion.source !== "google" && suggestion.precision === "none" ? <small>{suggestion.source === "municipal" ? "Directorio de Turismo · Confirmá la ubicación al elegirlo" : "Ubicá el punto en el mapa"}</small> : null}
                {suggestion.source !== "google" && suggestion.precision === "street" ? <small>{suggestion.source === "municipal" ? "Referencia de zona: ajustá el punto" : "Encontramos la calle, no la altura: ajustá el punto"}</small> : null}
                {suggestion.source !== "google" && suggestion.precision === "interpolated" ? <small>Referencia aproximada</small> : null}
                {coverage.enabled && suggestion.source !== "google" && suggestion.point && suggestion.precision === "exact" ? (
                  <small>{isInsideAirportPickupZone(suggestion.point, coverage) ? "Dentro de la cobertura" : "Fuera de la cobertura"}</small>
                ) : null}
              </li>
            ))}
          </ul>
          <SearchAttribution sources={suggestions.map(attributionSource)} />
        </>
      ) : null}
      {coordinateSourceUrl ? <p><a href={coordinateSourceUrl} target="_blank" rel="noreferrer">Fuente de la ubicación</a></p> : null}
      {selectionSource ? <SearchAttribution sources={coordinateSource ? [selectionSource, coordinateSource] : [selectionSource]} /> : null}

      <div className={styles.manual}>
        <button type="button" className={styles.manualToggle} aria-expanded={manualOpen}
          aria-controls={manualOpen ? streetListId : undefined} disabled={disabled}
          onClick={() => {
            setManualOpen((current) => !current);
            setManualError("");
          }}>
          {manualOpen ? "Ocultar el selector de calle y altura" : "¿Hay dos calles parecidas? Elegí la calle y poné la altura"}
        </button>
        {manualOpen ? (
          <>
            <div className={styles.manualRow}>
              <input type="text" aria-label="Calle" autoComplete="off" placeholder="Ej. Bertha Koessler" maxLength={80}
                value={streetTerm} disabled={disabled}
                onChange={(event) => {
                  setStreetTerm(event.target.value);
                  setStreet(null);
                  setHeight("");
                  setManualError("");
                }} />
              <input type="text" aria-label="Altura" inputMode="numeric" autoComplete="off" placeholder="Altura" maxLength={6}
                value={height} disabled={disabled || !street}
                onChange={(event) => {
                  setHeight(event.target.value.replace(/[^0-9A-Za-z]/g, ""));
                  setManualError("");
                }} />
              <button type="button" className="button"
                disabled={disabled || !street || !heightPattern.test(height.trim()) || resolving}
                onClick={() => void useStreetAddress()}>
                {resolving ? "Buscando…" : "Usar esta dirección"}
              </button>
            </div>
            {streets.length ? (
              <ul id={streetListId} className={styles.suggestions} aria-label="Calles del nomenclador">
                {streets.map((option) => (
                  <li key={option.name} onClick={() => {
                    setStreet(option);
                    setStreetTerm(option.name);
                    setStreets([]);
                    setManualError("");
                  }}>
                    {option.name}
                    <small>{option.category} · {option.locality}</small>
                  </li>
                ))}
              </ul>
            ) : null}
            {street ? (
              <p className="muted">
                Calle elegida: <strong>{street.name}</strong> ({street.category}). Escribí la altura y tocá «Usar esta dirección».
              </p>
            ) : streetTerm.trim().length >= 2 && !streets.length ? (
              <p className="muted">Sin calles con ese nombre. Probá con otro texto.</p>
            ) : null}
            {manualError ? <p className="muted" role="status">{manualError}</p> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
