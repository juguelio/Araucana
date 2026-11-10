import { z } from "zod";
import { ApiError } from "@/lib/api/responses";
import type { PickupPoint } from "./pickup-zone";

export const airportAddressSchema = z.string().trim().min(3).max(160);

const resultsSchema = z.array(z.object({
  lat: z.coerce.number().finite().min(-90).max(90),
  lon: z.coerce.number().finite().min(-180).max(180),
  display_name: z.string(),
  class: z.string().optional(),
  category: z.string().optional(),
  address: z.object({ house_number: z.string().optional() })
}));

const placeCategories = new Set(["tourism", "amenity", "shop", "leisure", "office", "building"]);
const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

export async function lookupAirportAddress(address: string): Promise<{ point: PickupPoint; label: string }> {
  const endpoint = process.env.AIRPORT_GEOCODER_URL;
  if (!endpoint) {
    throw new ApiError("ADDRESS_LOOKUP_UNAVAILABLE", "La búsqueda por dirección no está disponible en este momento.", 503);
  }

  const [firstPart, ...locationParts] = address.split(",");
  const nameOrStreet = firstPart.trim();
  const requestedLocations = locationParts.map(normalize).filter(Boolean);
  const houseNumber = nameOrStreet.match(/\b(\d+[a-z]?)$/i)?.[1]?.toLowerCase();

  const url = new URL(endpoint);
  url.searchParams.set("q", `${address}, ${requestedLocations.length ? "" : "San Martín de los Andes, "}Neuquén, Argentina`);
  url.searchParams.set("format", "json");
  url.searchParams.set("countrycodes", "ar");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  const key = process.env.AIRPORT_GEOCODER_KEY;
  if (key) url.searchParams.set("key", key);

  let candidates: z.infer<typeof resultsSchema>;
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!response.ok && response.status !== 404) throw new Error("Geocoder unavailable");
    candidates = response.status === 404 ? [] : resultsSchema.parse(await response.json());
  } catch {
    throw new ApiError("ADDRESS_LOOKUP_UNAVAILABLE", "No pudimos buscar la dirección. Volvé a intentar.", 503);
  }

  const matches = candidates.filter((candidate) => {
    const [name, ...locations] = candidate.display_name.split(",").map(normalize);
    if (!requestedLocations.every((location) => locations.some((part) =>
      part === location || part === `municipio de ${location}`
    ))) return false;
    if (houseNumber) return candidate.address.house_number?.toLowerCase() === houseNumber;

    const category = candidate.class ?? candidate.category ?? "";
    const query = normalize(nameOrStreet);
    if (category === "boundary" || category === "place") return name === query;
    return placeCategories.has(category) && name.startsWith(query);
  });
  const match = matches[0];
  if (!match) {
    throw new ApiError("ADDRESS_NOT_FOUND", "No encontramos el lugar. Probá con el nombre completo o con calle y altura.", 422);
  }
  if (matches.some(({ lat, lon }) => Math.abs(lat - match.lat) > 0.0001 || Math.abs(lon - match.lon) > 0.0001)) {
    throw new ApiError("ADDRESS_AMBIGUOUS", "Encontramos más de un lugar. Agregá el barrio o la localidad.", 422);
  }
  return { point: [match.lat, match.lon], label: match.display_name };
}
