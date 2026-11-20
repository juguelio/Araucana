import type { PickupPoint } from "./pickup-zone";

/** Referencias publicadas por cada alojamiento, revisadas el 2026-11-20.
 * No extraer coordenadas del centro de un iframe: pueden diferir del marcador.
 * Mantener separadas del catálogo municipal para no perderlas al actualizarlo.
 * Son puntos del establecimiento; el pasajero sigue confirmando la entrada.
 */
export const verifiedLodgingLocations: Record<string, { name: string; point: PickupPoint; sourceUrl: string; evidence: string }> = {
  "10": {
    name: "Alcedro",
    point: [-40.152507, -71.3454312],
    sourceUrl: "https://alcedro.wordpress.com/",
    evidence: "Marcador coordinates del mapa del sitio del alojamiento, Perito Moreno 1318."
  },
  "173": {
    name: "Plaza Mayor",
    point: [-40.161469, -71.350072],
    sourceUrl: "https://hosteriaplazamayor.com.ar/",
    evidence: "GeoCoordinates del sitio oficial. Publica Pérez 1199; el directorio municipal indica 1189. Punto del establecimiento, no altura interpolada."
  }
};
