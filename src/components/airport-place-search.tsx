"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { loadGoogleLibrary } from "@/lib/airport/google-maps";
import { isInsideAirportPickupZone, type AirportCoverage, type PickupPoint } from "@/lib/airport/pickup-zone";
import {
  airportSearchBounds, airportSearchLocality, isIntersectionQuery, prioritizeLocalPlaces, splitPlaceQuery, splitStreetAddress
} from "@/lib/airport/place-search-area";
import type { AirportPlaceSuggestion } from "@/lib/airport/place-suggestions";
import styles from "./airport-address-map.module.css";

type GoogleSuggestion = { source: "google"; label: string; prediction: google.maps.places.PlacePrediction };
type Suggestion = AirportPlaceSuggestion | GoogleSuggestion;
export type AirportSelectedPlace = { label: string; point: PickupPoint | null; approximate: boolean; source: Suggestion["source"] };

const googleAreaTypes = new Set(["locality", "sublocality", "neighborhood", "route", "administrative_area_level_3"]);
const googleAddressTypes = new Set(["street_address", "premise", "subpremise"]);

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

function SearchAttribution({ sources }: { sources: Suggestion["source"][] }) {
  return (
    <p className="muted">
      {sources.includes("google") ? <span translate="no">Google Maps </span> : null}
      {sources.includes("georef") ? <a href="https://www.argentina.gob.ar/georef" target="_blank" rel="noreferrer">GeoRef Argentina</a> : null}
      {sources.includes("locationiq") ? <><a href="https://locationiq.com" target="_blank" rel="noreferrer">LocationIQ</a>{" · "}</> : null}
      {sources.some((source) => source === "locationiq" || source === "photon") ? (
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
      ) : null}
    </p>
  );
}

type AirportPlaceSearchProps = {
  coverage: AirportCoverage;
  useGoogle: boolean;
  disabled: boolean;
  onChange: () => void;
  onSelect: (place: AirportSelectedPlace) => void;
};

export function AirportPlaceSearch({ coverage, useGoogle, disabled, onChange, onSelect }: AirportPlaceSearchProps) {
  const inputId = useId();
  const listId = `${inputId}-options`;
  const token = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const selectionVersion = useRef(0);
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectionSource, setSelectionSource] = useState<Suggestion["source"] | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const open = focused && suggestions.length > 0;

  useEffect(() => () => { selectionVersion.current++; }, []);

  useEffect(() => {
    if (searchTerm.trim().length < 3) return;
    const controller = new AbortController();
    const { signal } = controller;
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
            const { AutocompleteSessionToken, AutocompleteSuggestion } = await loadGoogleLibrary("places");
            if (signal.aborted) return;
            token.current ??= new AutocompleteSessionToken();
            const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
              input: numberedAddress && !context ? `${address}, ${airportSearchLocality}` : address,
              sessionToken: token.current,
              includedRegionCodes: ["ar"],
              locationRestriction: airportSearchBounds,
              language: "es",
              region: "ar"
            });
            googleResults = suggestions.flatMap(({ placePrediction }) => placePrediction
              ? [{ source: "google", label: placePrediction.text.toString(), prediction: placePrediction }]
              : []);
          } catch {
            token.current = null;
          }
          if (signal.aborted) return;
          if (!context) googleResults = prioritizeLocalPlaces(googleResults, (place) => place.label);
          if (numberedAddress && googleResults.length) {
            const addresses = googleResults.filter(({ prediction }) => prediction.types.some((type) => googleAddressTypes.has(type)));
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
        setSuggestions(results);
        if (results.length === 0) setError("No encontramos coincidencias. Probá otro nombre o marcá el punto en el mapa.");
      } catch {
        if (!signal.aborted) setError("No pudimos buscar lugares. Podés marcar el punto en el mapa.");
      } finally {
        if (!signal.aborted) setSearching(false);
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchTerm, useGoogle]);

  async function choose(suggestion: Suggestion) {
    const version = ++selectionVersion.current;
    setQuery(suggestion.label);
    setSearchTerm("");
    setSuggestions([]);
    setActiveIndex(-1);
    setError("");
    setSelectionSource(suggestion.source);

    token.current = null;
    if (suggestion.source !== "google") {
      setSearching(false);
      onSelect(suggestion);
      return;
    }

    setSearching(true);
    try {
      const place = suggestion.prediction.toPlace();
      await place.fetchFields({ fields: ["location"] });
      if (version !== selectionVersion.current) return;
      if (!place.location) throw new Error("Missing location");
      onSelect({
        source: "google",
        label: suggestion.label,
        point: [place.location.lat(), place.location.lng()],
        approximate: suggestion.prediction.types.some((type) => googleAreaTypes.has(type))
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
      <label htmlFor={inputId}>Dirección, esquina, barrio o comercio</label>
      <input id={inputId} type="text" role="combobox" aria-autocomplete="list" autoComplete="off"
        aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        placeholder="Ej. San Martín y Belgrano" value={query} maxLength={160} disabled={disabled}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        onChange={(event) => {
          selectionVersion.current++;
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
          onChange();
        }} />
      {searching ? <p className="muted" role="status">Buscando lugares…</p> : null}
      {error ? <p className="muted" role="status">{error}</p> : null}
      {open ? (
        <>
          <ul id={listId} role="listbox" aria-label="Sugerencias de lugares" className={styles.suggestions}>
            {suggestions.map((suggestion, index) => (
              <li key={suggestion.source === "google" ? suggestion.prediction.placeId : `${suggestion.label}:${suggestion.point ?? "sin-punto"}`}
                id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { if (!disabled) void choose(suggestion); }}>
                {suggestion.label}
                {suggestion.source !== "google" && !suggestion.point ? <small>Ubicá el punto en el mapa</small> : null}
                {suggestion.source !== "google" && suggestion.point && suggestion.approximate ? <small>Referencia aproximada</small> : null}
                {coverage.enabled && suggestion.source !== "google" && suggestion.point && !suggestion.approximate ? (
                  <small>{isInsideAirportPickupZone(suggestion.point, coverage) ? "Dentro de la cobertura" : "Fuera de la cobertura"}</small>
                ) : null}
              </li>
            ))}
          </ul>
          <SearchAttribution sources={suggestions.map((suggestion) => suggestion.source)} />
        </>
      ) : null}
      {selectionSource ? <SearchAttribution sources={[selectionSource]} /> : null}
    </div>
  );
}
