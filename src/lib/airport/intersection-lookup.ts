import { z } from "zod";
import { ApiError } from "@/lib/api/responses";
import type { PickupPoint } from "./pickup-zone";
import { intersectionStreets } from "./place-search-area";

export type AirportIntersection = { point: PickupPoint; label: string };

const street = z.string().trim().min(2).regex(/[\p{L}\p{N}]/u);
const results = z.object({
  direcciones: z.array(z.object({
    nomenclatura: z.string(),
    calle_cruce_1: z.object({ id: z.string().nullable() }),
    ubicacion: z.object({
      lat: z.number().min(-90).max(90).nullable(),
      lon: z.number().min(-180).max(180).nullable()
    })
  }))
});

export async function lookupAirportIntersection(address: string, requestSignal?: AbortSignal): Promise<AirportIntersection[]> {
  const [, locality = "San Martín de los Andes"] = address.split(",", 2).map((part) => part.trim());
  const streets = z.tuple([street, street]).safeParse(intersectionStreets(address));
  if (!streets.success) {
    throw new ApiError("INVALID_INTERSECTION", "Ingresá dos calles, por ejemplo Av. San Martín y Belgrano.", 400);
  }

  const url = new URL("https://apis.datos.gob.ar/georef/api/v2.0/direcciones");
  url.search = new URLSearchParams({
    direccion: streets.data.join(" y "),
    provincia: "58",
    localidad_censal: locality || "San Martín de los Andes",
    max: "10"
  }).toString();

  try {
    const timeout = AbortSignal.timeout(6000);
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
    const response = await fetch(url, { cache: "no-store", signal });
    if (!response.ok) throw new Error("GeoRef unavailable");
    const data = results.parse(await response.json());
    const matches = new Map<string, AirportIntersection>();

    for (const result of data.direcciones) {
      const { lat, lon } = result.ubicacion;
      if (result.calle_cruce_1.id && lat !== null && lon !== null) {
        matches.set(`${lat},${lon}`, { point: [lat, lon], label: result.nomenclatura });
      }
    }
    return [...matches.values()];
  } catch {
    throw new ApiError("INTERSECTION_LOOKUP_UNAVAILABLE", "No pudimos buscar la esquina. Podés marcar el punto en el mapa.", 503);
  }
}
