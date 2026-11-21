import { catalogueLodgings, municipalLodgingSuggestion } from "./lodging-catalogue";
import { airportSearchBounds, airportSearchLocality, normalizePlaceText, splitStreetAddress } from "./place-search-area";
import { suggestProviderAirportPlaces, type AirportPlaceSuggestion } from "./place-suggestions";

const urbanZones = new Set(["Centro", "Ejido urbano", "Barrio La Cascada"]);
const abbreviations: Record<string, string> = { av: "avenida", cnel: "coronel", tte: "teniente", gral: "general", pje: "pasaje", cap: "capitan" };
const streetKey = (value: string) => normalizePlaceText(value).split(" ").map((word) => abbreviations[word] ?? word).join(" ");

export function municipalStreetAddress(address: string) {
  const clean = address.replace(/\bN(?:[.º°\s]*[º°]|ro\.?)\s*/gi, "").trim();
  const parsed = splitStreetAddress(clean);
  // No reinterpretar rutas, kilómetros, unidades o múltiples alturas como domicilios simples.
  if (!parsed || /\d|\b(?:ruta|km|lote|dto|depto|departamento|piso|unidad)\b/i.test(parsed.street)) return null;
  return { street: streetKey(parsed.street), number: parsed.number };
}

export function matchesMunicipalAddress(label: string, address: NonNullable<ReturnType<typeof municipalStreetAddress>>) {
  if (!normalizePlaceText(label).includes(normalizePlaceText(airportSearchLocality))) return false;
  const parts = label.split(",").map((part) => part.trim());
  return parts.slice(0, 3).some((part, index) => {
    const parsed = municipalStreetAddress(part);
    return parsed ? parsed.street === address.street && parsed.number === address.number
      : normalizePlaceText(part) === address.number && streetKey(parts[index + 1] ?? "") === address.street;
  });
}

/** Prioriza el domicilio; admite establecimientos identificados por su nombre exacto y tipo. */
export async function resolveMunicipalLodging(id: string, requestSignal: AbortSignal): Promise<AirportPlaceSuggestion | null> {
  const lodging = catalogueLodgings.find((entry) => entry.id === id);
  if (!lodging) return null;
  const fallback = municipalLodgingSuggestion(lodging);
  if (requestSignal.aborted) return { ...fallback, point: null, precision: "none" };
  if (fallback.point) return fallback;
  const address = municipalStreetAddress(lodging.address);
  if (!urbanZones.has(lodging.zone) || !address || requestSignal.aborted) return fallback;
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(8000)]);
  try {
    const { south, north, west, east } = airportSearchBounds;
    const atAddress = (results: AirportPlaceSuggestion[]) => results.filter((result) => result.point && result.source !== "municipal"
      && (result.precision === "exact" || (result.precision === "interpolated" && result.source === "georef"))
      && result.point[0] >= south && result.point[0] <= north && result.point[1] >= west && result.point[1] <= east
      && matchesMunicipalAddress(result.label, address));
    const named = await suggestProviderAirportPlaces(lodging.name, signal).catch(() => []);
    let candidates = atAddress(named);
    let locationMatch: "address" | "establishment" = "address";
    // Algunos predios figuran sobre otra calle. Sólo aceptar el nombre completo,
    // categoría de alojamiento, localidad y un nombre único en el directorio.
    const name = normalizePlaceText(lodging.name);
    const uniqueName = catalogueLodgings.filter((entry) => normalizePlaceText(entry.name) === name).length === 1;
    if (!candidates.length && uniqueName) {
      candidates = named.filter((result) => result.isLodging && result.precision === "exact" && result.point
        && normalizePlaceText(result.label.split(",")[0]) === name
        && normalizePlaceText(result.label).includes(normalizePlaceText(airportSearchLocality))
        && result.point[0] >= south && result.point[0] <= north && result.point[1] >= west && result.point[1] <= east);
      if (candidates.length) locationMatch = "establishment";
    }
    if (!candidates.length && !signal.aborted) {
      candidates = atAddress(await suggestProviderAirportPlaces(`${address.street} ${address.number}, ${airportSearchLocality}`, signal));
    }
    if (signal.aborted) return fallback;
    const match = candidates[0];
    if (!match?.point || match.source === "municipal") return fallback;
    // Fuentes que discrepan más de ~20 m requieren ubicar el punto manualmente.
    if (candidates.some((other) => Math.hypot(other.point![0] - match.point![0], other.point![1] - match.point![1]) > 0.0002)) return fallback;
    return { ...fallback, point: match.point, precision: match.precision, approximate: true, coordinateSource: match.source, locationMatch };
  } catch {
    return fallback;
  }
}
