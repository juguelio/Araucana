import { z } from "zod";
import { airportSearchLocality, normalizePlaceText } from "./place-search-area";
import type { AirportPlaceSuggestion } from "./place-suggestions";
import { suggestAirportPlaces } from "./place-suggestions";

/**
 * Calles del nomenclador municipal. El cliente pidió poder elegir la calle
 * cuando hay homónimas (Bertha Koessler y Av. Rodolfo Koessler) y después
 * cargar la altura, en vez de depender de escribir "calle + número" de corrido.
 */
export type StreetOption = { name: string; category: string; locality: string };

const geoRefStreets = z.object({
  calles: z.array(z.object({
    nombre: z.string(),
    categoria: z.string(),
    localidad_censal: z.object({ nombre: z.string() })
  }))
});

/** "BERTHA KOESSLER" → "Bertha Koessler"; "AV RODOLFO KOESSLER" → "Av Rodolfo Koessler". */
export function streetLabel(name: string) {
  return name.toLocaleLowerCase("es").replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("es"));
}

export function streetCategory(category: string) {
  const normalized = category.trim().toUpperCase();
  if (normalized === "AV") return "Avenida";
  if (normalized.startsWith("PJE") || normalized.startsWith("PASAJE")) return "Pasaje";
  if (normalized.startsWith("RUTA")) return "Ruta";
  return "Calle";
}

async function fetchStreets(name: string, requestSignal: AbortSignal) {
  const url = new URL("https://apis.datos.gob.ar/georef/api/v2.0/calles");
  url.search = new URLSearchParams({
    nombre: name,
    provincia: "58",
    localidad_censal: airportSearchLocality,
    max: "8"
  }).toString();

  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(4000)]);
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("GeoRef streets unavailable");
  return geoRefStreets.parse(await response.json()).calles;
}

export async function lookupStreetOptions(query: string, requestSignal: AbortSignal): Promise<StreetOption[]> {
  const search = query.trim();
  if (search.length < 2) return [];
  let calles = await fetchStreets(search, requestSignal);
  // El nomenclador busca por prefijo: "rodolfo koessler" no matchea
  // "AV RODOLFO KOESSLER", así que se reintenta con la última palabra.
  if (!calles.length && search.includes(" ")) {
    calles = await fetchStreets(search.split(/\s+/).at(-1) ?? search, requestSignal);
  }
  const seen = new Set<string>();
  return calles.flatMap((street) => {
    const name = streetLabel(street.nombre);
    if (seen.has(name)) return [];
    seen.add(name);
    return [{ name, category: streetCategory(street.categoria), locality: street.localidad_censal.nombre }];
  });
}

/**
 * Domicilio exacto a partir de la calle elegida y la altura tipeada. Usa la
 * búsqueda normal (GeoRef + geocoders) y, si ninguno tiene coordenadas, devuelve
 * el domicilio sin punto para que se marque en el mapa.
 */
export async function resolveStreetAddress(
  street: string,
  number: string,
  requestSignal: AbortSignal
): Promise<AirportPlaceSuggestion | null> {
  const height = number.trim();
  const name = street.trim();
  if (!name || !/^\d{1,5}[a-z]?$/i.test(height)) return null;

  const matches = await suggestAirportPlaces(`${name} ${height}`, requestSignal);
  const target = normalizePlaceText(name);
  const same = matches.find((match) => {
    const label = normalizePlaceText(match.label.split(",")[0]);
    return label === target || label.startsWith(`${target} `) || label.endsWith(` ${target}`);
  });
  if (same) return same;
  return {
    label: `${streetLabel(name)} ${height}, ${airportSearchLocality}`,
    point: null,
    source: "georef",
    approximate: true,
    precision: "none"
  };
}
