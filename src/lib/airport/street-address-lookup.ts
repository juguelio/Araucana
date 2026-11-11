import { z } from "zod";
import { airportSearchLocality } from "./place-search-area";

const geoRefAddresses = z.object({
  direcciones: z.array(z.object({
    calle: z.object({ nombre: z.string() }),
    altura: z.object({ valor: z.number() }),
    localidad_censal: z.object({ nombre: z.string() }),
    ubicacion: z.object({
      lat: z.number().min(-90).max(90).nullable(),
      lon: z.number().min(-180).max(180).nullable()
    })
  }))
});

export async function lookupStreetAddresses(address: string, locality: string, requestSignal: AbortSignal) {
  const url = new URL("https://apis.datos.gob.ar/georef/api/v2.0/direcciones");
  url.search = new URLSearchParams({
    direccion: address,
    provincia: "58",
    localidad_censal: locality || airportSearchLocality,
    max: "5"
  }).toString();

  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(4000)]);
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("GeoRef unavailable");
  return geoRefAddresses.parse(await response.json()).direcciones;
}
