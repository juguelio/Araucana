import catalogue from "./data/sma-lodgings.json";
import { airportSearchLocality, normalizePlaceText, splitPlaceQuery } from "./place-search-area";
import type { AirportPlaceSuggestion } from "./place-suggestions";

export const municipalLodgings = catalogue.lodgings;
export const municipalLodgingsSource = catalogue.sourceUrl;

export function municipalLodgingSuggestion(lodging: typeof municipalLodgings[number]): AirportPlaceSuggestion {
  return {
    label: `${lodging.name}, ${lodging.address} · ${lodging.zone} · ${lodging.type}`,
    lodgingId: lodging.id, source: "municipal", point: null, approximate: true, precision: "none"
  };
}

const ignoredWords = new Set([
  "hotel", "hoteles", "hote", "hostal", "hostel", "hostels", "hosteria", "hosterias",
  "cabana", "cabanas", "apart", "aparts", "apartamento", "apartamentos", "departamento", "departamentos",
  "aparthotel", "aparthoteles", "depto", "deptos", "dpto", "dptos", "bungalow", "bungalows",
  "alojamiento", "alojamientos", "alquiler", "turistico", "temporario", "camping", "campings",
  "residencial", "residenciales", "albergue", "albergues", "rural", "rurales", "areas",
  "de", "del", "el", "la", "las", "los", "en", "y"
]);

export function lodgingNameWords(value: string) {
  return normalizePlaceText(value).split(" ").filter((word) => word && !ignoredWords.has(word));
}

/** Una sola letra omitida, agregada o cambiada; nunca corrige números de domicilio. */
function oneLetterAway(a: string, b: string) {
  if (a.length < 5 || b.length < 5 || /\d/.test(a + b) || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + Number(i < a.length || j < b.length) <= 1;
}

const indexed = municipalLodgings.map((lodging) => ({
  lodging,
  name: normalizePlaceText(lodging.name),
  words: lodgingNameWords(lodging.name),
  address: normalizePlaceText(lodging.address),
  zone: normalizePlaceText(lodging.zone)
}));

export function findMunicipalLodgings(query: string, limit = 8) {
  if (query.trim().length < 3) return [];
  const { name, context } = splitPlaceQuery(query);
  const normalizedContext = normalizePlaceText(context);
  const locality = normalizePlaceText(airportSearchLocality);
  // La localidad explícita siempre manda: no ofrecer homónimos de SMA en Junín.
  const localContext = !context || normalizedContext.includes(locality);
  const normalizedName = normalizePlaceText(name).replace(new RegExp(` ${locality}$`), "");
  const words = lodgingNameWords(normalizedName);
  return indexed.flatMap((item) => {
    if (!localContext && normalizedContext !== item.zone) return [];
    let score = 0;
    if (item.name === normalizedName) score = 1000;
    else if (item.name.startsWith(normalizedName)) score = 900;
    else if (words.length && words.every((word) => item.words.includes(word))) score = 800;
    else if (words.length && words.every((word) => item.words.some((candidate) =>
      candidate === word || (word.length >= 3 && candidate.startsWith(word))))) score = 700;
    else if (words.length && words.every((word) => item.words.some((candidate) =>
      candidate === word || oneLetterAway(word, candidate)))) score = 600;
    else if (/\d/.test(normalizedName) && item.address === normalizedName) score = 500;
    return score ? [{ ...item.lodging, score }] : [];
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function suggestMunicipalLodgings(query: string): AirportPlaceSuggestion[] {
  return findMunicipalLodgings(query).map(municipalLodgingSuggestion);
}

/** Conserva el catálogo incluso sin Google/Photon; no confunde un nombre con un pin verificado. */
export function withMunicipalLodgings<T extends { label: string; source: string }>(query: string, external: T[]) {
  const municipal = suggestMunicipalLodgings(query);
  const signature = (label: string) => lodgingNameWords(label.split(",")[0]).sort().join(" ");
  // Primero las opciones del proveedor que coinciden por nombre con el catálogo:
  // permiten elegir un punto disponible sin adjudicárselo a otra ficha homónima.
  // Se conservan ambas direcciones para que el pasajero pueda compararlas.
  const matching = external.filter((place) => place.source !== "municipal" && place.source !== "georef"
    && (!("precision" in place) || place.precision === "exact")
    && municipal.some((local) => signature(local.label) === signature(place.label)));
  const combined: (T | AirportPlaceSuggestion)[] = [...matching, ...municipal, ...external];
  return [...new Map(combined.map((place) => [`${place.source}:${place.label}`, place])).values()];
}
