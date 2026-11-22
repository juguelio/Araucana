import data from "./data/sma-street-references.json";
import { airportSearchLocality, normalizePlaceText } from "./place-search-area";
import type { AirportPlaceSuggestion } from "./place-suggestions";

const abbreviations: Record<string, string> = {
  avenida: "av", pasaje: "pje", boulevard: "blvd", doctor: "dr", general: "gral",
  teniente: "tte", coronel: "cnel", capitan: "cap", sargento: "sgto"
};

export function streetKey(value: string) {
  return normalizePlaceText(value).split(" ").map(word => abbreviations[word] ?? word).join(" ");
}

const references = new Map(Object.entries(data.streets).map(([name, entry]) => [streetKey(name), entry]));

function onSide(height: number, start: number, end: number) {
  return start > 0 && end > 0 && height >= Math.min(start, end) && height <= Math.max(start, end)
    && (start % 2 !== end % 2 || height % 2 === start % 2);
}

/** Los puntos son centros sobre el trazado de cuadras de GeoRef. Las calles homónimas se excluyen. */
export function localStreetReference(street: string, number: string, locality: string): AirportPlaceSuggestion | null {
  if (normalizePlaceText(locality) !== normalizePlaceText(airportSearchLocality)) return null;
  const entry = references.get(streetKey(street));
  if (!entry) return null;
  const height = Number(number);
  const blocks = entry.blocks.filter(([a, b, c, d]) => onSide(height, a, b) || onSide(height, c, d));
  const [lat, lng] = blocks.length === 1 ? blocks[0].slice(4) : entry.point;
  return {
    label: `${street} ${number}, ${airportSearchLocality}`,
    point: [lat, lng], approximate: true, precision: blocks.length === 1 ? "interpolated" : "street",
    source: "georef", coordinateSourceUrl: data.sourceUrl
  };
}
