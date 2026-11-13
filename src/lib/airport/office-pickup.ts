import { z } from "zod";
import { getSetting, setSetting } from "@/lib/settings/app-settings";

/**
 * Punto de salida fijo de la agencia: el atajo «salir desde la sucursal» del checkout del
 * aeropuerto (#34).
 *
 * El cliente lo pidió junto con «mi ubicación» y «buscar en el mapa»: en vez de tipear la
 * dirección de la oficina cada vez, un toque deja el traslado apuntando a la sucursal. La
 * dirección y el punto los carga la agencia desde el panel, así que no hace falta un deploy para
 * cambiarlos (la oficina se muda o el mapa corrige una coordenada).
 *
 * Se guarda aparte de la cobertura a propósito: la cobertura decide **cuánto se cobra**, esto es
 * sólo un atajo de carga. Si el punto cae en la zona con recargo, el recargo se aplica igual.
 */

const key = "airport.officePickup";

const latitud = z.number().finite().min(-90).max(90);
const longitud = z.number().finite().min(-180).max(180);

export const airportOfficePickupSchema = z.object({
  enabled: z.boolean(),
  /** Nombre corto que aparece en el botón («Salir desde …»). */
  label: z.string().trim().min(1, "Poné un nombre para el atajo.").max(60),
  address: z.string().trim().min(3, "Poné la dirección de la oficina.").max(160),
  point: z.tuple([latitud, longitud]).nullable()
});

export type AirportOfficePickup = z.infer<typeof airportOfficePickupSchema>;

export const defaultAirportOfficePickup: AirportOfficePickup = {
  enabled: false,
  label: "la sucursal",
  address: "Mariano Moreno 829, San Martín de los Andes",
  point: null
};

export async function getAirportOfficePickup(db?: Parameters<typeof getSetting>[1]): Promise<AirportOfficePickup> {
  const saved = await getSetting(key, db);
  if (!saved) return defaultAirportOfficePickup;
  try {
    return airportOfficePickupSchema.parse({ ...defaultAirportOfficePickup, ...JSON.parse(saved) });
  } catch {
    // Una configuración vieja o rota no puede romper el checkout: se ignora y queda sin atajo.
    return defaultAirportOfficePickup;
  }
}

export async function saveAirportOfficePickup(pickup: AirportOfficePickup, userId: string) {
  await setSetting(key, JSON.stringify(airportOfficePickupSchema.parse(pickup)), userId);
}

/** El atajo sólo se ofrece si está activo **y** tiene un punto: sin coordenadas no hay nada que marcar. */
export function officePickupReady(
  pickup: AirportOfficePickup
): pickup is AirportOfficePickup & { point: [number, number] } {
  return pickup.enabled && Array.isArray(pickup.point) && pickup.point.length === 2;
}
