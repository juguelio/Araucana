import { distanceMeters } from "@/lib/driver/location";

/**
 * Orden del recorrido de la hoja del día (pedido del cliente).
 *
 * Los arribos usan vecino más cercano desde el aeropuerto. Las partidas con oficina configurada usan
 * un camino abierto oficina → retiros → aeropuerto: Held–Karp hasta 12 retiros y vecino más cercano +
 * 2-opt para recorridos mayores. Se minimiza distancia geográfica, no distancia por calles ni tránsito.
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

/** Aeropuerto Chapelco: origen de los arribos y destino de las partidas. */
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

/** Camino abierto con origen y destino fijos; no agrega un regreso al origen. */
export function optimizarEntreExtremos<T>(
  paradas: T[],
  coordenadas: CoordenadasDe<T>,
  origen: PickupCoords,
  destino: PickupCoords
): T[] {
  const enOrigen: T[] = [];
  const ubicadas: T[] = [];
  const sinUbicar: T[] = [];
  for (const parada of paradas) {
    const punto = coordenadas(parada);
    if (!punto) sinUbicar.push(parada);
    // Los pasajeros que esperan en el origen suben antes de salir, también en empates de distancia.
    else if (distanceMeters(origen, punto) < 1) enOrigen.push(parada);
    else ubicadas.push(parada);
  }
  if (ubicadas.length < 2) return [...enOrigen, ...ubicadas, ...sinUbicar];

  const puntos = ubicadas.map((parada) => coordenadas(parada)!);
  const desdeOrigen = puntos.map((punto) => distanceMeters(origen, punto));
  const hastaDestino = puntos.map((punto) => distanceMeters(punto, destino));
  const distancias = puntos.map((a) => puntos.map((b) => distanceMeters(a, b)));
  const n = puntos.length;
  let orden: number[];

  if (n <= 12) {
    // Held–Karp: coste mínimo de visitar un subconjunto terminando en cada retiro.
    const estados = 1 << n;
    const costes = new Float64Array(estados * n).fill(Infinity);
    const anteriores = new Int16Array(estados * n).fill(-1);
    for (let i = 0; i < n; i += 1) costes[(1 << i) * n + i] = desdeOrigen[i];
    for (let mascara = 1; mascara < estados; mascara += 1) {
      for (let ultimo = 0; ultimo < n; ultimo += 1) {
        if (!(mascara & (1 << ultimo))) continue;
        const coste = costes[mascara * n + ultimo];
        for (let siguiente = 0; siguiente < n; siguiente += 1) {
          if (mascara & (1 << siguiente)) continue;
          const indice = (mascara | (1 << siguiente)) * n + siguiente;
          const candidato = coste + distancias[ultimo][siguiente];
          if (candidato < costes[indice]) {
            costes[indice] = candidato;
            anteriores[indice] = ultimo;
          }
        }
      }
    }
    let mascara = estados - 1;
    let ultimo = 0;
    for (let i = 1; i < n; i += 1) {
      if (costes[mascara * n + i] + hastaDestino[i] < costes[mascara * n + ultimo] + hastaDestino[ultimo]) ultimo = i;
    }
    orden = [];
    while (ultimo >= 0) {
      orden.push(ultimo);
      const anterior = anteriores[mascara * n + ultimo];
      mascara ^= 1 << ultimo;
      ultimo = anterior;
    }
    orden.reverse();
  } else {
    const indices = ubicadas.map((_, i) => i);
    const coordenadaDeIndice = (i: number) => puntos[i];
    const semillas = [
      ordenarPorRecorrido(indices, coordenadaDeIndice, origen),
      ordenarPorRecorrido(indices, coordenadaDeIndice, destino).reverse(),
      indices
    ];
    const largo = (ruta: number[]) => desdeOrigen[ruta[0]] + hastaDestino[ruta.at(-1)!]
      + ruta.slice(1).reduce((total, i, j) => total + distancias[ruta[j]][i], 0);
    const mejorar = (semilla: number[]) => {
      const ruta = [...semilla];
      // 2-opt invierte tramos que acortan el camino, incluyendo las conexiones a ambos extremos.
      for (let vuelta = 0; vuelta < 40; vuelta += 1) {
        let cambio = false;
        for (let i = 0; i < n - 1; i += 1) {
          for (let j = i + 1; j < n; j += 1) {
            const a = ruta[i];
            const b = ruta[j];
            const antes = (i ? distancias[ruta[i - 1]][a] : desdeOrigen[a])
              + (j < n - 1 ? distancias[b][ruta[j + 1]] : hastaDestino[b]);
            const despues = (i ? distancias[ruta[i - 1]][b] : desdeOrigen[b])
              + (j < n - 1 ? distancias[a][ruta[j + 1]] : hastaDestino[a]);
            if (antes - despues > 0.01) {
              ruta.splice(i, j - i + 1, ...ruta.slice(i, j + 1).reverse());
              cambio = true;
            }
          }
        }
        if (!cambio) break;
      }
      return ruta;
    };
    const candidatas = semillas.map(mejorar);
    orden = candidatas.reduce((mejor, candidata) => largo(candidata) < largo(mejor) ? candidata : mejor);
  }

  return [...enOrigen, ...orden.map((i) => ubicadas[i]), ...sinUbicar];
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
