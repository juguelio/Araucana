import { getVerifiedLodgingLocation } from "./lodging-locations";
import catalogue from "./data/sma-lodgings.json";
import complementary from "./data/sma-lodgings-complementary.json";
import { airportSearchLocality, normalizePlaceText, splitPlaceQuery } from "./place-search-area";
import type { AirportPlaceSuggestion } from "./place-suggestions";

export const municipalLodgings = catalogue.lodgings;
export const municipalLodgingsSource = catalogue.sourceUrl;

/**
 * Fichas verificadas fuera del listado municipal: fichas municipales que el listado no muestra
 * («sma-N») y alojamientos habilitados sólo por la provincia («nqn-…»). Si el padrón vuelve a listar
 * una ficha municipal, manda el padrón y la complementaria se descarta para no duplicarla.
 */
export function unlistedLodgings<T extends { municipalId: string | null }>(entries: T[], listedIds: Set<string>) {
  return entries.filter((entry) => !entry.municipalId || !listedIds.has(entry.municipalId));
}
export const complementaryLodgings = unlistedLodgings(complementary.lodgings, new Set(municipalLodgings.map(({ id }) => id)));
/** Padrón municipal más las fichas complementarias: lo que busca y selecciona el buscador. */
export const catalogueLodgings: CatalogueLodging[] = [...municipalLodgings, ...complementaryLodgings];
export type CatalogueLodging = { id: string; name: string; type: string; zone: string; address: string; sourceUrl: string };

export function municipalLodgingSuggestion(lodging: CatalogueLodging): AirportPlaceSuggestion {
  const location = getVerifiedLodgingLocation(lodging);
  return {
    label: `${lodging.name}, ${lodging.address} · ${lodging.zone} · ${lodging.type}`,
    lodgingId: lodging.id, source: "municipal", point: location?.point ?? null, approximate: true,
    precision: location?.precision ?? "none",
    ...(location ? { locationMatch: location.locationMatch, coordinateSourceUrl: location.sourceUrl } : {})
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

// Nombre comercial corroborado en la ficha del establecimiento; Turismo conserva el nombre abreviado.
const commercialNames: Record<string, { municipalName: string; aliases: string[] }> = {
  "183": { municipalName: "Turismo", aliases: ["Hotel Turismo Patagonia", "Turismo Patagonia"] }
};
const indexed = catalogueLodgings.map((lodging) => ({
  lodging,
  names: [lodging.name, ...(commercialNames[lodging.id]?.municipalName === lodging.name
    ? commercialNames[lodging.id].aliases : [])].map((name) => ({ name: normalizePlaceText(name), words: lodgingNameWords(name) })),
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
    const nameScore = Math.max(...item.names.map((candidate) => {
      if (candidate.name === normalizedName) return 1000;
      if (candidate.name.startsWith(normalizedName)) return 900;
      if (words.length && words.every((word) => candidate.words.includes(word))) return 800;
      if (words.length && words.every((word) => candidate.words.some((part) =>
        part === word || (word.length >= 3 && part.startsWith(word))))) return 700;
      if (words.length && words.every((word) => candidate.words.some((part) =>
        part === word || oneLetterAway(word, part)))) return 600;
      return 0;
    }));
    const score = nameScore || (/\d/.test(normalizedName) && item.address === normalizedName ? 500 : 0);
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
  // La referencia revisada del catálogo tiene prioridad sobre coincidencias externas.
  // Conservamos otras direcciones para no confundir establecimientos homónimos.
  const matching = external.filter((place) => place.source !== "municipal" && place.source !== "georef"
    && (!("precision" in place) || place.precision === "exact")
    && municipal.some((local) => signature(local.label) === signature(place.label)));
  const combined: (T | AirportPlaceSuggestion)[] = [...municipal.filter((place) => place.point), ...matching, ...municipal.filter((place) => !place.point), ...external];
  return [...new Map(combined.map((place) => [`${place.source}:${place.label}`, place])).values()];
}
