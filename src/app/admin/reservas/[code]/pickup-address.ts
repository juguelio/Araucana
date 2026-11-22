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

/**
 * Por qué no se puede guardar el domicilio, o `ok` si se puede. Existe para que el botón de guardar
 * pueda decir el motivo (#343): el aviso vive arriba del mapa y el operador mira el pie del
 * formulario, así que un guardado bloqueado se leía como «el botón no anda» y «no veo el rojo».
 */
export type PickupBlock = "ok" | "sin-punto" | "sin-direccion" | "sin-confirmar" | "fuera-de-zona";

/** El texto que se muestra junto al botón de guardar para cada motivo. */
export const PICKUP_BLOCK_MESSAGES: Record<Exclude<PickupBlock, "ok">, string> = {
  "sin-punto": "Marcá el punto en el mapa: este traslado se guarda con coordenadas.",
  "sin-direccion": "Escribí una dirección o marcá el punto en el mapa.",
  "sin-confirmar": "Falta tildar «Confirmo que el mapa marca el lugar correcto», arriba del domicilio.",
  "fuera-de-zona": "El punto está fuera de la zona de cobertura: movelo dentro del mapa o elegí otro domicilio."
};

export function pickupBlockReason(changed: boolean, draft: PickupAddressDraft, { airport, outside }: PickupSaveOptions): PickupBlock {
  if (!changed) return "ok";
  if (!draft.point) {
    if (!airport) return "sin-punto";
    return draft.address.trim().length > 0 ? "ok" : "sin-direccion";
  }
  if (outside) return "fuera-de-zona";
  return draft.confirmed ? "ok" : "sin-confirmar";
}

/** ¿El domicilio se puede guardar tal como está? Sin punto, sólo en el aeropuerto y con texto. */
export function canSavePickup(changed: boolean, draft: PickupAddressDraft, options: PickupSaveOptions) {
  return pickupBlockReason(changed, draft, options) === "ok";
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
