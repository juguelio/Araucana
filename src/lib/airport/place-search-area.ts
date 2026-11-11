export const airportSearchCenter = { lat: -40.153, lng: -71.344 };
export const airportSearchBounds = { south: -40.22, west: -71.48, north: -40.04, east: -71.07 };
export const airportSearchLocality = "San Martín de los Andes";

export function normalizePlaceText(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function splitPlaceQuery(query: string) {
  const [name, ...context] = query.split(",").map((part) => part.trim()).filter(Boolean);
  return { name: name ?? "", context: context.join(", ") };
}

export function splitStreetAddress(name: string) {
  const match = /^(.*\p{L}.*?)\s+(\d+[a-z]?)$/iu.exec(name);
  return match ? { street: match[1], number: match[2].toLowerCase() } : null;
}

export function prioritizeLocalPlaces<T>(places: T[], label: (place: T) => string) {
  const locality = normalizePlaceText(airportSearchLocality);
  const local = (place: T) => normalizePlaceText(label(place)).includes(locality);
  return [...places].sort((a, b) => Number(local(b)) - Number(local(a)));
}

export function intersectionStreets(query: string) {
  const [streets] = query.split(",", 1);
  const explicit = streets.split(/\s+(?:esquina(?:\s+con)?|&)\s+/i);
  return explicit.length > 1 ? explicit : streets.split(/\s+y\s+/i);
}

export function isIntersectionQuery(query: string) {
  const parts = intersectionStreets(query);
  return parts.length === 2 && parts.every((part) => part.trim().length >= 2);
}
