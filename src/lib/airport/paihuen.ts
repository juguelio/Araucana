import { normalizePlaceText } from "./place-search-area";
import type { PickupPoint } from "./pickup-zone";

/** Entrada del establecimiento 147 del catálogo municipal. */
export const PAIHUEN_POINT: PickupPoint = [-40.1754504, -71.3950852];

export function isPaihuen(name?: string | null, address?: string | null, point?: PickupPoint | null) {
  if (point && Math.abs(point[0] - PAIHUEN_POINT[0]) < 0.00001 && Math.abs(point[1] - PAIHUEN_POINT[1]) < 0.00001) return true;
  return [name, address].some(value => {
    const label = normalizePlaceText((value ?? "").split(/[,·]/)[0]);
    return /^(?:(?:hotel|cabanas|resort) )?paihuen(?: resort)?(?: de montana)?$/.test(label);
  });
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
