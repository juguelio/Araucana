import { z } from "zod";
import { ApiError } from "@/lib/api/responses";
import { lookupAirportIntersection } from "./intersection-lookup";
import {
  airportSearchBounds, airportSearchCenter, airportSearchLocality, isIntersectionQuery,
  normalizePlaceText, prioritizeLocalPlaces, splitPlaceQuery, splitStreetAddress
} from "./place-search-area";
import type { PickupPoint } from "./pickup-zone";
import { lookupStreetAddresses } from "./street-address-lookup";

export type AirportPlaceSuggestion = {
  label: string;
  /**
   * `null` cuando el nomenclador municipal confirma el domicilio pero ningún
   * geocoder tiene sus coordenadas: el domicilio se puede cargar igual y el
   * punto lo marca el operador en el mapa. Nunca se inventan coordenadas.
   */
  point: PickupPoint | null;
  source: "georef" | "locationiq" | "photon";
  approximate: boolean;
};

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const photonResponse = z.object({
  features: z.array(z.object({
    geometry: z.object({ type: z.literal("Point"), coordinates: z.tuple([longitude, latitude]) }),
    properties: z.object({
      name: z.string().optional(),
      street: z.string().optional(),
      housenumber: z.string().optional(),
      city: z.string().optional(),
      district: z.string().optional(),
      type: z.string().optional()
    })
  }))
});
const locationIqResponse = z.array(z.object({
  lat: z.coerce.number().pipe(latitude),
  lon: z.coerce.number().pipe(longitude),
  display_name: z.string(),
  type: z.string().optional(),
  class: z.string().optional()
}));

const nominatimStreetResponse = z.array(z.object({
  lat: z.coerce.number().pipe(latitude),
  lon: z.coerce.number().pipe(longitude)
}));

/** Punto del eje de la calle cuando ninguna fuente tiene la altura exacta. */
const streetPointCache = new Map<string, { point: PickupPoint | null; at: number }>();
const streetPointTtl = 6 * 60 * 60 * 1000;

/** Sólo para tests: el cache vive mientras viva el proceso. */
export function resetStreetPointCache() {
  streetPointCache.clear();
}

const { south, west, north, east } = airportSearchBounds;
const viewbox = [west, south, east, north].join(",");
const areaTypes = new Set(["city", "locality", "district", "suburb", "neighbourhood", "quarter", "village", "street", "road"]);

function locationIqAutocomplete() {
  const endpoint = process.env.AIRPORT_GEOCODER_URL;
  const key = process.env.AIRPORT_GEOCODER_KEY;
  if (!endpoint || !key) return null;
  const { hostname } = new URL(endpoint);
  if (hostname !== "locationiq.com" && !hostname.endsWith(".locationiq.com")) return null;
  const url = new URL("https://api.locationiq.com/v1/autocomplete");
  url.searchParams.set("key", key);
  return url;
}

async function lookupNamedPlaces(query: string, requestSignal: AbortSignal): Promise<AirportPlaceSuggestion[]> {
  const locationIqUrl = locationIqAutocomplete();
  const photonEndpoint = process.env.AIRPORT_PHOTON_URL
    || (process.env.NODE_ENV === "development" ? "https://photon.komoot.io/api/" : "");
  const url = locationIqUrl ?? (photonEndpoint ? new URL(photonEndpoint) : null);
  if (!url) {
    throw new ApiError("ADDRESS_LOOKUP_UNAVAILABLE", "El buscador de lugares no está disponible. Podés marcar el punto en el mapa.", 503);
  }

  const { lat, lng } = airportSearchCenter;
  const params = locationIqUrl
    ? { q: query, viewbox, bounded: "1", countrycodes: "ar", limit: "6", "accept-language": "es" }
    : { q: query, bbox: viewbox, lat: String(lat), lon: String(lng), limit: "6" };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  try {
    const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(6000)]);
    const response = await fetch(url, { cache: "no-store", signal });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error("Geocoder unavailable");
    const payload = await response.json();

    if (locationIqUrl) {
      return locationIqResponse.parse(payload).map((place) => ({
        label: place.display_name, point: [place.lat, place.lon], source: "locationiq",
        approximate: areaTypes.has(place.type ?? "") || ["place", "boundary", "highway"].includes(place.class ?? "")
      }));
    }

    return photonResponse.parse(payload).features.flatMap(({ properties, geometry }) => {
      const { name, street, housenumber, district, city, type } = properties;
      const address = [street, housenumber].filter(Boolean).join(" ");
      const primary = housenumber && street ? address : name;
      const label = [...new Set([primary, address, district, city].filter(Boolean))].join(", ");
      if (!label) return [];
      const [lon, lat] = geometry.coordinates;
      return [{ label, point: [lat, lon], source: "photon", approximate: areaTypes.has(type ?? "") }];
    });
  } catch {
    throw new ApiError("ADDRESS_LOOKUP_UNAVAILABLE", "No pudimos buscar lugares. Podés marcar el punto en el mapa.", 503);
  }
}

/** "Avenida X" y "Av X" son la misma calle; "San Martín" y "Av San Martín" no. */
const streetAbbreviations: Record<string, string> = { avenida: "av", pasaje: "pje", boulevard: "blvd" };

function streetKey(value: string) {
  return normalizePlaceText(value)
    .split(" ")
    .map((word) => streetAbbreviations[word] ?? word)
    .join(" ");
}

async function nominatimStreetPoint(street: string, requestSignal: AbortSignal): Promise<PickupPoint | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: `${street}, ${airportSearchLocality}`,
    format: "jsonv2",
    limit: "1",
    countrycodes: "ar"
  }).toString();
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(4000)]);
  const response = await fetch(url, {
    cache: "no-store",
    signal,
    headers: {
      "User-Agent": "AraucanaViajes/1.0 (contacto@araucana.com.ar)",
      "Accept-Language": "es"
    }
  });
  if (!response.ok) return null;
  const [place] = nominatimStreetResponse.parse(await response.json());
  return place ? [place.lat, place.lon] : null;
}

/**
 * Busca dónde cae la calle para anclar el pin cuando nadie tiene esa altura.
 * Primero el geocoder comercial de la app y, si no la conoce o está limitado,
 * OpenStreetMap. Se cachea para no repetir la consulta por cada búsqueda.
 */
async function lookupStreetPoint(street: string, requestSignal: AbortSignal): Promise<PickupPoint | null> {
  const key = streetKey(street);
  const cached = streetPointCache.get(key);
  if (cached && Date.now() - cached.at < streetPointTtl) return cached.point;

  const named = await lookupNamedPlaces(street, requestSignal).catch(() => []);
  const match = named.find((candidate) => candidate.point
    && streetKey(candidate.label.split(",")[0]) === key);
  const point = match?.point ?? await nominatimStreetPoint(street, requestSignal).catch(() => null);
  // Un fallo puede ser transitorio: los "sin punto" se recuerdan poco.
  if (!requestSignal.aborted) streetPointCache.set(key, { point, at: point ? Date.now() : Date.now() - streetPointTtl + 5 * 60 * 1000 });
  return point;
}

function matchesStreetNumber(label: string, street: string, number: string) {
  const [first, second] = label.split(",").map(normalizePlaceText);
  const address = splitStreetAddress(first);
  const matchedStreet = first === number ? second : address?.number === number ? address.street : undefined;
  return Boolean(matchedStreet && (matchedStreet === street || matchedStreet.endsWith(` ${street}`)));
}

async function suggestStreetAddress(name: string, context: string, address: NonNullable<ReturnType<typeof splitStreetAddress>>, signal: AbortSignal) {
  const locality = context || airportSearchLocality;
  const street = normalizePlaceText(address.street);
  const named = await lookupNamedPlaces(`${name}, ${locality}`, signal).catch((error: unknown) => error);
  const exact = Array.isArray(named)
    ? named.filter((match) => matchesStreetNumber(match.label, street, address.number))
    : [];
  if (exact.length || signal.aborted) return exact;

  const official = await lookupStreetAddresses(name, context.split(",")[0], signal).catch(() => []);
  const suggestions: AirportPlaceSuggestion[] = [];
  for (const match of official) {
    if (String(match.altura.valor) !== address.number || signal.aborted) continue;
    const officialStreet = match.calle.nombre.toLocaleLowerCase("es").replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("es"));
    const { nombre: city } = match.localidad_censal;
    const label = `${officialStreet} ${address.number}, ${city}`;
    const { lat, lon } = match.ubicacion;
    if (lat !== null && lon !== null) {
      suggestions.push({ label, point: [lat, lon], source: "georef", approximate: true });
      continue;
    }

    const candidates = await lookupNamedPlaces(label, signal).catch(() => []);
    const canonical = normalizePlaceText(officialStreet);
    const canonicalExact = candidates.filter((candidate) => matchesStreetNumber(candidate.label, canonical, address.number));
    if (canonicalExact.length) {
      suggestions.push(...canonicalExact);
      continue;
    }
    const reference = candidates.find((candidate) => candidate.approximate
      && normalizePlaceText(candidate.label.split(",")[0]) === canonical);
    if (reference) {
      suggestions.push({ ...reference, label, approximate: true });
      continue;
    }
    // La altura exacta no está en ningún geocoder, pero la calle puede estarlo:
    // se ancla el pin sobre el eje para que el operador lo arrastre hasta la altura.
    const streetPoint = await lookupStreetPoint(officialStreet, signal);
    if (streetPoint) {
      suggestions.push({ label, point: streetPoint, source: "georef", approximate: true });
      continue;
    }
    // Tampoco la calle: GeoRef tiene el domicilio y ningún geocoder la conoce.
    // Se ofrece igual; el punto se marca en el mapa.
    suggestions.push({ label, point: null, source: "georef", approximate: true });
  }
  if (!suggestions.length && !Array.isArray(named)) throw named;
  return suggestions;
}

export async function suggestAirportPlaces(query: string, signal: AbortSignal): Promise<AirportPlaceSuggestion[]> {
  if (isIntersectionQuery(query)) {
    const corners = await lookupAirportIntersection(query, signal).catch(() => []);
    if (corners.length > 0) {
      return corners.map((corner) => ({ ...corner, source: "georef", approximate: false }));
    }
  }

  const search = query.replace(/^barrio\s+/i, "");
  if (search.length < 3 || signal.aborted) return [];
  const { name, context } = splitPlaceQuery(search);
  const address = splitStreetAddress(name);
  const matches = address
    ? await suggestStreetAddress(name, context, address, signal)
    : await lookupNamedPlaces(search, signal);
  const unique = [...new Map(matches.map((match) => [
    `${match.label}:${match.point ? match.point.join(",") : "sin-punto"}`, match
  ])).values()];
  return context ? unique : prioritizeLocalPlaces(unique, (place) => place.label);
}
