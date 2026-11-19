import type { PickupPoint } from "@/lib/airport/pickup-zone";

/** Lo que el operador tiene cargado en el domicilio del traslado mientras edita. */
export type PickupAddressDraft = { address: string; point: PickupPoint | null; confirmed: boolean };

/**
 * Aviso para el operador cuando guarda un domicilio sin punto (#268): el nombre del alojamiento que
 * ningún geocoder ubica se guarda como texto, igual que una dirección sin geometría. Lo dice de
 * frente para que no parezca que el guardado quedó a medias.
 */
export const PICKUP_WITHOUT_POINT =
  "Va sin coordenadas en el mapa: se guarda el domicilio como texto y no se valida la zona de servicio.";

type PickupSaveOptions = {
  /** Sólo el aeropuerto guarda el domicilio sin coordenadas: el traslado de Chapelco las exige en la base. */
  airport: boolean;
  /** El punto marcado cae fuera de la cobertura. */
  outside: boolean;
};

/** ¿El domicilio se puede guardar tal como está? Sin punto, sólo en el aeropuerto y con texto. */
export function canSavePickup(changed: boolean, draft: PickupAddressDraft, { airport, outside }: PickupSaveOptions) {
  if (!changed) return true;
  if (!draft.point) return airport && draft.address.trim().length > 0;
  return draft.confirmed && !outside;
}

export type PickupFormFields = { address: string; latitude?: string; longitude?: string; confirmed?: "on" };

/**
 * Campos del formulario para el server action. Sin punto no viajan coordenadas ni la confirmación
 * del mapa: el servidor guarda el texto y deja la latitud y la longitud en `null`.
 */
export function pickupFormFields(draft: PickupAddressDraft): PickupFormFields {
  if (!draft.point) return { address: draft.address };
  return {
    address: draft.address,
    latitude: String(draft.point[0]),
    longitude: String(draft.point[1]),
    confirmed: "on"
  };
}
