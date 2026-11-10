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
const referenceCategories = new Set(["natural", "water", "waterway"]);
const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

function similarPlaceName(name: string, query: string) {
  const words = (value: string) => value.split(/[^a-z0-9]+/).filter((word) => word && word !== "de" && word !== "del");
  const expected = words(query);
  const actual = words(name);
  if (expected.length < 2 || expected.length !== actual.length) return false;
  const differences = expected.map((word, index) => [word, actual[index]]).filter(([a, b]) => a !== b);
  if (!differences.length) return true;
  if (differences.length !== 1) return false;
  const [a, b] = differences[0];
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 5 || longer.length - shorter.length > 1) return false;
  const mismatch = [...shorter].findIndex((letter, index) => letter !== longer[index]);
  if (mismatch === -1) return longer.length === shorter.length + 1;
  return shorter.slice(mismatch + (shorter.length === longer.length ? 1 : 0)) === longer.slice(mismatch + 1);
}

export async function lookupAirportAddress(address: string): Promise<{ point: PickupPoint; label: string; approximate?: boolean }> {
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

  async function fetchCandidates() {
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (!response.ok && response.status !== 404) throw new Error("Geocoder unavailable");
      return response.status === 404 ? [] : resultsSchema.parse(await response.json());
    } catch {
      throw new ApiError("ADDRESS_LOOKUP_UNAVAILABLE", "No pudimos buscar la dirección. Volvé a intentar.", 503);
    }
  }

  const candidates = await fetchCandidates();
  const query = normalize(nameOrStreet);
  const localCandidates = candidates.map((candidate) => {
    const [name, ...locations] = candidate.display_name.split(",").map(normalize);
    return { ...candidate, name, locations, category: candidate.class ?? candidate.category ?? "" };
  }).filter(({ locations }) => requestedLocations.every((location) => locations.some((part) =>
      part === location || part === `municipio de ${location}`
  )));
  const exactMatches = localCandidates.filter((candidate) => {
    if (houseNumber) return candidate.address.house_number?.toLowerCase() === houseNumber;
    const { name, category } = candidate;
    if (category === "boundary" || category === "place" || referenceCategories.has(category)) return name === query;
    return placeCategories.has(category) && name.startsWith(query);
  });
  let matches = exactMatches.length || houseNumber ? exactMatches : localCandidates.filter(({ name, category }) =>
    (!category || category === "boundary" || category === "place" || placeCategories.has(category)) &&
    similarPlaceName(name, query)
  );
  if (!matches.length && !houseNumber && !requestedLocations.length && /^(lago|laguna|rio|arroyo|cerro) /.test(query)) {
    url.searchParams.set("q", `${address}, Neuquén, Argentina`);
    matches = (await fetchCandidates()).flatMap((candidate) => {
      const [name] = candidate.display_name.split(",").map(normalize);
      const category = candidate.class ?? candidate.category ?? "";
      return name === query && referenceCategories.has(category) ? [{ ...candidate, name, category, locations: [] }] : [];
    });
  }
  const match = matches[0];
  if (!match) {
    throw new ApiError("ADDRESS_NOT_FOUND", "No encontramos el lugar. Probá con el nombre completo o con calle y altura.", 422);
  }
  if (matches.some(({ lat, lon }) => Math.abs(lat - match.lat) > 0.0001 || Math.abs(lon - match.lon) > 0.0001)) {
    throw new ApiError("ADDRESS_AMBIGUOUS", "Encontramos más de un lugar. Agregá el barrio o la localidad.", 422);
  }
  return { point: [match.lat, match.lon], label: match.display_name, ...(referenceCategories.has(match.category) ? { approximate: true } : {}) };
}
