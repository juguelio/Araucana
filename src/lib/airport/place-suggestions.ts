import { z } from "zod";
import { ApiError } from "@/lib/api/responses";
import { lookupAirportIntersection } from "./intersection-lookup";
import { airportSearchBounds, airportSearchCenter, isIntersectionQuery } from "./place-search-area";
import type { PickupPoint } from "./pickup-zone";

export type AirportPlaceSuggestion = {
  label: string;
  point: PickupPoint;
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
      const label = [...new Set([name, address, district, city].filter(Boolean))].join(", ");
      if (!label) return [];
      const [lon, lat] = geometry.coordinates;
      return [{ label, point: [lat, lon], source: "photon", approximate: areaTypes.has(type ?? "") }];
    });
  } catch {
    throw new ApiError("ADDRESS_LOOKUP_UNAVAILABLE", "No pudimos buscar lugares. Podés marcar el punto en el mapa.", 503);
  }
}

export async function suggestAirportPlaces(query: string, signal: AbortSignal): Promise<AirportPlaceSuggestion[]> {
  if (isIntersectionQuery(query)) {
    const corners = await lookupAirportIntersection(query, signal).catch(() => []);
    if (corners.length > 0) {
      return corners.map((corner) => ({ ...corner, source: "georef", approximate: false }));
    }
  }

  const name = query.replace(/^barrio\s+/i, "");
  if (name.length < 3 || signal.aborted) return [];
  const matches = await lookupNamedPlaces(name, signal);
  return [...new Map(matches.map((match) => [`${match.label}:${match.point.join(",")}`, match])).values()];
}
