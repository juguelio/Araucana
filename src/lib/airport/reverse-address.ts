import lines from "./data/sma-street-lines.json";
import { airportSearchLocality } from "./place-search-area";
import type { PickupPoint } from "./pickup-zone";

const metersPerDegree = 111_200;
const lngScale = Math.cos(40.15 * Math.PI / 180);

/** Distancia al tramo más cercano sobre el trazado, incluso en las curvas. */
export function nearbyStreet([lat, lng]: PickupPoint) {
  let closest = 60 ** 2;
  let street = "";
  for (const [name, blocks] of Object.entries(lines.roads)) {
    for (const coords of blocks) {
      for (let i = 2; i < coords.length; i += 2) {
        const x = (coords[i - 1] - lng) * metersPerDegree * lngScale;
        const y = (coords[i - 2] - lat) * metersPerDegree;
        const dx = (coords[i + 1] - coords[i - 1]) * metersPerDegree * lngScale;
        const dy = (coords[i] - coords[i - 2]) * metersPerDegree;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared ? Math.max(0, Math.min(1, -(x * dx + y * dy) / lengthSquared)) : 0;
        const distance = (x + t * dx) ** 2 + (y + t * dy) ** 2;
        if (distance < closest) {
          closest = distance;
          street = name;
        }
      }
    }
  }
  return street ? `${street}, ${airportSearchLocality}` : null;
}

export async function reverseAirportAddress(point: PickupPoint, requestSignal: AbortSignal) {
  const endpoint = process.env.AIRPORT_GEOCODER_URL;
  const key = process.env.AIRPORT_GEOCODER_KEY;
  if (key && endpoint && new URL(endpoint).hostname.endsWith(".locationiq.com")) {
    try {
      const url = new URL("/v1/reverse", endpoint);
      url.search = new URLSearchParams({ key, lat: String(point[0]), lon: String(point[1]),
        format: "json", addressdetails: "1", "accept-language": "es" }).toString();
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([requestSignal, AbortSignal.timeout(3500)]) });
      if (response.ok) {
        const { address, lat, lon } = await response.json();
        const distance = Math.hypot(Number(lat) - point[0], (Number(lon) - point[1]) * lngScale) * metersPerDegree;
        const road = address?.road || address?.pedestrian || address?.residential;
        if (typeof road === "string" && distance <= 100) {
          const number = distance <= 35 ? address.house_number : "";
          const street = [road, number].filter(Boolean).join(" ");
          return [street, address.city || address.town || address.village].filter(Boolean).join(", ").slice(0, 160);
        }
      }
    } catch {
      if (requestSignal.aborted) return null;
    }
  }
  return nearbyStreet(point);
}
