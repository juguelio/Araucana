import { normalizePlaceText } from "./place-search-area";
import type { PickupPoint } from "./pickup-zone";

/** Entrada del establecimiento 147 del catálogo municipal. */
export const PAIHUEN_POINT: PickupPoint = [-40.1754504, -71.3950852];

export const PAIHUEN_UNIT_CENTS = 1_300_000;

/** Radio real de detección: el geocoder del mismo lugar devuelve 1–4 m de diferencia, y 150 m no llega
 *  a una dirección vecina de la Ruta 40. Antes era 1e-5° (≈1 m) y fallaba con el punto del buscador (#357). */
export const PAIHUEN_RADIUS_M = 150;

const EARTH_RADIUS_M = 6_371_000;

export function distanciaMetros(a: PickupPoint, b: PickupPoint) {
  const rad = (grados: number) => (grados * Math.PI) / 180;
  const dLat = rad(a[0] - b[0]);
  const dLng = rad(a[1] - b[1]);
  const latMedia = rad((a[0] + b[0]) / 2);
  return Math.hypot(dLat, dLng * Math.cos(latMedia)) * EARTH_RADIUS_M;
}

export function isPaihuen(name?: string | null, address?: string | null, point?: PickupPoint | null) {
  if (point && distanciaMetros(point, PAIHUEN_POINT) <= PAIHUEN_RADIUS_M) return true;
  // La grafía no puede decidir el cobro (#357): «Paihuén Villa de Montaña» o «Hotel Paihuén» tienen que
  // detectarse igual que «Paihuen». Se busca la palabra en el texto normalizado, sin anclar el resto.
  return [name, address].some(value => normalizePlaceText(value ?? "").split(" ").includes("paihuen"));
}

export function isPaihuenReservation(pickup: {
  pickupName?: string | null; pickupAddress?: string | null;
  pickupLatitude?: number | null; pickupLongitude?: number | null;
}) {
  const { pickupLatitude: lat, pickupLongitude: lng } = pickup;
  return isPaihuen(pickup.pickupName, pickup.pickupAddress, lat != null && lng != null ? [lat, lng] : null);
}

export function paihuenPickupTime(start: Date, applies: boolean): Date;
export function paihuenPickupTime(start: Date | null, applies: boolean): Date | null;
export function paihuenPickupTime(start: Date | null, applies: boolean) {
  return start && applies ? new Date(start.getTime() - 15 * 60_000) : start;
}
