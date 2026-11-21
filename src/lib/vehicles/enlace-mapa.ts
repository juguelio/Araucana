/**
 * Enlace del tablero de flota al mapa en vivo (pedido de Jugue, 21/11): desde la lista se pincha una
 * unidad y se la ve en el mapa, sin tener que abrir «Naves en vivo» y buscarla en la lista de al lado.
 *
 * La unidad viaja como `?unidad=<vehicleId>`: el id no cambia aunque cambie el interno o la patente, y
 * la página del mapa ya lo acepta (busca por id, por interno o por la clave chofer/nave).
 */
export function enlaceAlMapa(vehicleId: string) {
  return `/admin/naves/en-vivo?unidad=${encodeURIComponent(vehicleId)}`;
}

/** Cómo se nombra una unidad en pantalla: «Interno 24» o, si no tiene número, el nombre del vehículo. */
export function nombreDeUnidad(vehiculo: { internalNumber: string | null; name: string }) {
  return vehiculo.internalNumber ? `Interno ${vehiculo.internalNumber}` : vehiculo.name;
}
