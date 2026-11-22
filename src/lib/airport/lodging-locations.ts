import locations from "./data/sma-lodging-locations.json";
import type { PickupPoint } from "./pickup-zone";
import { normalizePlaceText } from "./place-search-area";

export type LodgingLocation = {
  name: string;
  address: string;
  point: PickupPoint;
  precision: "exact" | "interpolated" | "street";
  locationMatch: "establishment" | "address";
  sourceUrl: string;
  checkedOn: string;
  evidence: string;
};

/** Referencias revisadas, separadas del catálogo que se actualiza desde Turismo.
 * Son marcadores del lugar/domicilio, nunca el centro del visor del mapa.
 * No certifican la entrada ni amplían la zona de cobertura del traslado.
 */
export const verifiedLodgingLocations = locations as unknown as Record<string, LodgingLocation>;

export function getVerifiedLodgingLocation(lodging: { id: string; name: string; address: string }) {
  const reference = verifiedLodgingLocations[lodging.id];
  // Un ID reutilizado o un domicilio cambiado requieren una nueva revisión.
  if (!reference || normalizePlaceText(reference.name) !== normalizePlaceText(lodging.name)
    || normalizePlaceText(reference.address) !== normalizePlaceText(lodging.address)) return null;
  return reference;
}
