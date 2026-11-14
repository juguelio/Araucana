import { distanceMeters } from "@/lib/driver/location";

/**
 * Orden del recorrido de la hoja del día (pedido del cliente).
 *
 * Hoy la orden de servicio lista los pasajeros por nombre, así que el chofer cruza la ciudad de un lado
 * al otro. Acá se calcula un recorrido razonable: desde el aeropuerto, siempre el próximo retiro más
 * cercano al que se está parado (vecino más cercano). No es el óptimo matemático —eso sería TSP exacto,
 * innecesario para 20 retiros— pero evita el zigzag y no consume ninguna API paga.
 */

export type PickupCoords = { latitude: number; longitude: number };

/** De dónde sacar las coordenadas de cada parada. `null` = esa parada no está ubicada. */
export type CoordenadasDe<T> = (parada: T) => PickupCoords | null;

const coordenadasDirectas = <T,>(parada: T): PickupCoords | null => {
  const valor = parada as { latitude?: unknown; longitude?: unknown };
  return typeof valor.latitude === "number" && typeof valor.longitude === "number"
    ? { latitude: valor.latitude, longitude: valor.longitude }
    : null;
};

/** Aeropuerto Chapelco (ACP), punto de partida y de llegada de todos los traslados. */
export const AEROPUERTO_CHAPELCO: PickupCoords = { latitude: -40.0753, longitude: -71.1374 };

/**
 * Ordena las paradas por cercanía encadenada desde `origen`. Las que no tienen coordenadas van al final,
 * en su orden original: no se inventa una ubicación para ellas.
 */
export function ordenarPorRecorrido<T>(
  paradas: T[],
  coordenadas: CoordenadasDe<T> = coordenadasDirectas,
  origen: PickupCoords = AEROPUERTO_CHAPELCO
): T[] {
  const conUbicacion: T[] = [];
  const sinUbicacion: T[] = [];

  for (const parada of paradas) {
    if (coordenadas(parada)) conUbicacion.push(parada);
    else sinUbicacion.push(parada);
  }

  const pendientes = [...conUbicacion];
  const recorrido: T[] = [];
  let actual: PickupCoords = origen;

  while (pendientes.length > 0) {
    let mejorIndice = 0;
    let mejorDistancia = Number.POSITIVE_INFINITY;

    for (let indice = 0; indice < pendientes.length; indice += 1) {
      const punto = coordenadas(pendientes[indice]);
      if (!punto) continue;
      const distancia = distanceMeters(actual, punto);
      if (distancia < mejorDistancia) {
        mejorDistancia = distancia;
        mejorIndice = indice;
      }
    }

    const [siguiente] = pendientes.splice(mejorIndice, 1);
    recorrido.push(siguiente);
    actual = coordenadas(siguiente) as PickupCoords;
  }

  return [...recorrido, ...sinUbicacion];
}

/** Metros que se caminan/recorren en el orden dado, para poder comparar antes y después. */
export function largoDelRecorrido(paradas: Array<PickupCoords>, origen: PickupCoords = AEROPUERTO_CHAPELCO): number {
  let actual = origen;
  let total = 0;
  for (const parada of paradas) {
    total += distanceMeters(actual, parada);
    actual = parada;
  }
  return total;
}

/**
 * El WhatsApp del pasajero para que el chofer lo contacte con un click. Los números que se cargan son
 * argentinos: si vienen sin país se les pone 54 9, y si vienen con 54 sin el 9 se lo agrega (los móviles
 * lo necesitan). Un número que no tiene dígitos suficientes no genera link.
 */
export function whatsappDigitos(telefono: string): string | null {
  let digitos = telefono.replace(/\D/g, "");
  if (!digitos) return null;
  if (digitos.startsWith("54")) {
    const resto = digitos.slice(2);
    if (!resto.startsWith("9")) digitos = `549${resto}`;
  } else if (digitos.length >= 10) {
    digitos = `549${digitos}`;
  }
  return digitos.length >= 10 ? digitos : null;
}

export function whatsappLink(telefono: string): string | null {
  const digitos = whatsappDigitos(telefono);
  return digitos ? `https://wa.me/${digitos}` : null;
}
