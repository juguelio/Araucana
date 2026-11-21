import { catalogueLodgings, municipalLodgingSuggestion } from "./lodging-catalogue";
import { airportSearchBounds, airportSearchLocality, normalizePlaceText, splitStreetAddress } from "./place-search-area";
import { suggestProviderAirportPlaces, type AirportPlaceSuggestion } from "./place-suggestions";

const abbreviations: Record<string, string> = {
  av: "avenida", alte: "almirante", almirante: "almirante", bv: "bulevar", bulevar: "bulevar",
  cnel: "coronel", coronel: "coronel", tte: "teniente", teniente: "teniente", gral: "general", general: "general",
  pje: "pasaje", pasaje: "pasaje", cap: "capitan", capitan: "capitan", dr: "doctor", doctor: "doctor",
  gdor: "gobernador", gobernador: "gobernador"
};
const streetKey = (value: string) => normalizePlaceText(value).split(" ").map((word) => abbreviations[word] ?? word).join(" ");

export function municipalStreetAddress(address: string) {
  const clean = address.replace(/\bN(?:[.º°\s]*[º°]|ro\.?)\s*/gi, "").trim();
  const parsed = splitStreetAddress(clean);
  // No reinterpretar rutas, kilómetros, unidades o múltiples alturas como domicilios simples.
  if (!parsed || /\d|\b(?:ruta|km|lote|dto|depto|departamento|piso|unidad)\b/i.test(parsed.street)) return null;
  return { street: streetKey(parsed.street), number: parsed.number };
}

const streetTokens = (value: string) => value.split(" ").filter(Boolean);

/**
 * El catálogo abrevia y el geocoder desarrolla (o al revés), y encima el geocoder suele agregar el
 * nombre de pila: «Belgrano» → «Manuel Belgrano», «Goñi» → «Luis Goñi», «Alte. Brown» → «Almirante
 * Brown». Se comparan tokens con sufijo, no igualdad exacta, para que esas direcciones no queden sin
 * pin; el número sigue exigiéndose exacto.
 */
export function sameMunicipalStreet(a: string, b: string) {
  const first = streetTokens(normalizePlaceText(a));
  const second = streetTokens(normalizePlaceText(b));
  if (first.join(" ") === second.join(" ")) return true;
  if (!first.length || !second.length) return false;
  const [short, long] = first.length <= second.length ? [first, second] : [second, first];
  return long.slice(long.length - short.length).every((word, index) => word === short[index]);
}

export function matchesMunicipalAddress(label: string, address: NonNullable<ReturnType<typeof municipalStreetAddress>>) {
  if (!normalizePlaceText(label).includes(normalizePlaceText(airportSearchLocality))) return false;
  const parts = label.split(",").map((part) => part.trim());
  return parts.slice(0, 3).some((part, index) => {
    const parsed = municipalStreetAddress(part);
    return parsed ? sameMunicipalStreet(parsed.street, address.street) && parsed.number === address.number
      : normalizePlaceText(part) === address.number && sameMunicipalStreet(streetKey(parts[index + 1] ?? ""), address.street);
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
  // Antes acá había una lista de zonas («Centro», «Ejido urbano», «Barrio La Cascada») que dejaba
  // afuera 97 de 269 fichas —Alrededores, Lago Lácar, 7 Lagos, Lolog, Huechulafquen— antes de
  // intentar ubicarlas, aunque el geocoder las tenga. El límite geográfico real es
  // `airportSearchBounds`, que se aplica sobre el punto más abajo.
  if (!address || requestSignal.aborted) return fallback;
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(8000)]);
  try {
    const { south, north, west, east } = airportSearchBounds;
    // La verificación que protege es `matchesMunicipalAddress` (calle y altura exactas) más el
    // bounding box; el proveedor que interpola la altura no agrega ni quita seguridad. En esta
    // ciudad la altura la interpola LocationIQ, y exigir GeoRef dejaba sin pin a la mayoría.
    const atAddress = (results: AirportPlaceSuggestion[]) => results.filter((result) => result.point && result.source !== "municipal"
      && (result.precision === "exact" || result.precision === "interpolated")
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
    const precisionRank = (result: AirportPlaceSuggestion) => result.precision === "exact" ? 2 : result.precision === "interpolated" ? 1 : 0;
    const matchesAddress = (result: AirportPlaceSuggestion) => matchesMunicipalAddress(result.label, address);
    // Se elige el candidato que coincide con el domicilio del directorio y, entre esos, el más
    // preciso: la puerta del establecimiento (exact) antes que el eje de la calle (interpolated).
    const ranked = [...candidates].sort((a, b) => Number(matchesAddress(b)) - Number(matchesAddress(a)) || precisionRank(b) - precisionRank(a));
    const match = ranked[0];
    if (!match?.point || match.source === "municipal") return fallback;
    // El guard de ~20 m queda, pero sólo entre candidatos igual de válidos: mismo domicilio y misma
    // precisión. Dos fuentes que ubican así el mismo lugar y no coinciden son un empate, y ahí es
    // preferible que el operador marque el punto antes que mandar un chofer a la dirección equivocada.
    const peers = ranked.filter((other) => matchesAddress(other) === matchesAddress(match) && precisionRank(other) === precisionRank(match));
    if (peers.some((other) => Math.hypot(other.point![0] - match.point![0], other.point![1] - match.point![1]) > 0.0002)) return fallback;
    return { ...fallback, point: match.point, precision: match.precision, approximate: true, coordinateSource: match.source, locationMatch };
  } catch {
    return fallback;
  }
}
