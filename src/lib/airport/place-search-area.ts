export const airportSearchCenter = { lat: -40.153, lng: -71.344 };
export const airportSearchBounds = { south: -40.22, west: -71.48, north: -40.04, east: -71.07 };

export function intersectionStreets(query: string) {
  const [streets] = query.split(",", 1);
  const explicit = streets.split(/\s+(?:esquina(?:\s+con)?|&)\s+/i);
  return explicit.length > 1 ? explicit : streets.split(/\s+y\s+/i);
}

export function isIntersectionQuery(query: string) {
  const parts = intersectionStreets(query);
  return parts.length === 2 && parts.every((part) => part.trim().length >= 2);
}
