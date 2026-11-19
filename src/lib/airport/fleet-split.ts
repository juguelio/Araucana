import { distanceMeters } from "@/lib/driver/location";
import { AEROPUERTO_CHAPELCO, largoDelRecorrido, ordenarPorRecorrido, type PickupCoords } from "./route-order";

/**
 * Reparto de los retiros entre las naves de una misma vuelta (pedido del cliente: dos vuelos llenos que
 * salen juntos con dos trafics). Cortar la recorrida única cuando se llena la primera nave deja a las dos
 * cruzando la ciudad; acá cada nave se queda con una zona.
 *
 * Se minimiza la suma de los recorridos de todas las naves, medidos igual que la hoja: desde el
 * aeropuerto, encadenando el retiro más cercano (`ordenarPorRecorrido` + `largoDelRecorrido`). Reglas:
 * - nunca se pasa la capacidad de una nave ni se parte una reserva;
 * - lo que ya está en una nave (elegido a mano) se queda ahí y cuenta para su recorrido y su lugar;
 * - es determinista (sin azar, empates por código): la orden en pantalla, el Excel y el link del chofer
 *   lo calculan cada uno por su lado y tienen que dar lo mismo.
 *
 * El algoritmo arranca de dos repartos —zonas sembradas por los retiros más alejados entre sí, y el corte
 * de la recorrida única que se usaba antes— y mejora cada uno moviendo e intercambiando reservas entre
 * naves mientras el total baje. Gana el más corto, así que nunca queda peor que el corte anterior.
 */

export type ParadaARepartir = { code: string; seats: number; pickup: PickupCoords };
export type NaveARepartir = { id: string; libres: number; fijas: PickupCoords[] };

/** Menos que esto no es una mejora: evita dar vueltas por diferencias de redondeo. */
const MEJORA_MINIMA_METROS = 1;
const MAX_VUELTAS = 60;

const porCodigo = (a: ParadaARepartir, b: ParadaARepartir) => a.code.localeCompare(b.code);

function largoDeNave(fijas: PickupCoords[], paradas: ParadaARepartir[], origen: PickupCoords) {
  const puntos = [...fijas, ...paradas.map((parada) => parada.pickup)];
  return puntos.length ? largoDelRecorrido(ordenarPorRecorrido(puntos, (punto) => punto, origen), origen) : 0;
}

type Reparto = { asignadas: ParadaARepartir[][]; sobrantes: ParadaARepartir[] };

function lugaresUsados(paradas: ParadaARepartir[]) {
  return paradas.reduce((total, parada) => total + parada.seats, 0);
}

/** Zonas: una semilla por nave (los retiros más alejados entre sí) y cada retiro a la semilla más cercana con lugar. */
function repartoPorZonas(paradas: ParadaARepartir[], naves: NaveARepartir[]): Reparto {
  const semillas: PickupCoords[] = [];
  const candidatas = [...paradas].sort(porCodigo);
  if (candidatas.length) {
    // Primera semilla: la más lejana del aeropuerto; después, la más lejana de las semillas ya elegidas.
    let primera = candidatas[0];
    for (const parada of candidatas) {
      if (distanceMeters(AEROPUERTO_CHAPELCO, parada.pickup) > distanceMeters(AEROPUERTO_CHAPELCO, primera.pickup)) primera = parada;
    }
    semillas.push(primera.pickup);
    while (semillas.length < naves.length) {
      let mejor: ParadaARepartir | null = null;
      let mejorDistancia = -1;
      for (const parada of candidatas) {
        const distancia = Math.min(...semillas.map((semilla) => distanceMeters(semilla, parada.pickup)));
        if (distancia > mejorDistancia) {
          mejorDistancia = distancia;
          mejor = parada;
        }
      }
      semillas.push((mejor ?? primera).pickup);
    }
  }
  // Una nave que ya tiene pasajeros fijados arranca desde su zona: su semilla es el primero de ellos.
  const semillaDe = naves.map((nave, indice) => nave.fijas[0] ?? semillas[indice] ?? AEROPUERTO_CHAPELCO);

  const libres = naves.map((nave) => nave.libres);
  const asignadas: ParadaARepartir[][] = naves.map(() => []);
  const sobrantes: ParadaARepartir[] = [];
  // Primero las reservas grandes, que son las difíciles de acomodar; después por código.
  const orden = [...paradas].sort((a, b) => b.seats - a.seats || porCodigo(a, b));
  for (const parada of orden) {
    let elegida = -1;
    let mejorDistancia = Number.POSITIVE_INFINITY;
    naves.forEach((_, indice) => {
      if (libres[indice] < parada.seats) return;
      const distancia = distanceMeters(semillaDe[indice], parada.pickup);
      if (distancia < mejorDistancia) {
        mejorDistancia = distancia;
        elegida = indice;
      }
    });
    if (elegida < 0) {
      sobrantes.push(parada);
      continue;
    }
    libres[elegida] -= parada.seats;
    asignadas[elegida].push(parada);
  }
  return { asignadas, sobrantes };
}

/** El reparto de antes: una sola recorrida que se corta cuando se llena cada nave. */
function repartoPorCorte(paradas: ParadaARepartir[], naves: NaveARepartir[], origen: PickupCoords): Reparto {
  const libres = naves.map((nave) => nave.libres);
  const asignadas: ParadaARepartir[][] = naves.map(() => []);
  const sobrantes: ParadaARepartir[] = [];
  for (const parada of ordenarPorRecorrido([...paradas].sort(porCodigo), (item) => item.pickup, origen)) {
    const indice = libres.findIndex((lugar) => lugar >= parada.seats);
    if (indice < 0) {
      sobrantes.push(parada);
      continue;
    }
    libres[indice] -= parada.seats;
    asignadas[indice].push(parada);
  }
  return { asignadas, sobrantes };
}

/** Mueve e intercambia reservas entre naves mientras el recorrido total baje. */
function mejorar(reparto: Reparto, naves: NaveARepartir[], origen: PickupCoords): Reparto {
  const asignadas = reparto.asignadas.map((paradas) => [...paradas].sort(porCodigo));
  const largos = asignadas.map((paradas, indice) => largoDeNave(naves[indice].fijas, paradas, origen));
  const libre = (indice: number) => naves[indice].libres - lugaresUsados(asignadas[indice]);
  const largo = (indice: number, paradas: ParadaARepartir[]) => largoDeNave(naves[indice].fijas, paradas, origen);

  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta += 1) {
    let mejoro = false;

    // Mover una reserva a otra nave con lugar.
    for (let desde = 0; desde < naves.length; desde += 1) {
      for (const parada of [...asignadas[desde]]) {
        for (let hacia = 0; hacia < naves.length; hacia += 1) {
          if (hacia === desde || libre(hacia) < parada.seats) continue;
          const sinElla = asignadas[desde].filter((item) => item !== parada);
          const conElla = [...asignadas[hacia], parada].sort(porCodigo);
          const nuevoDesde = largo(desde, sinElla);
          const nuevoHacia = largo(hacia, conElla);
          if (largos[desde] + largos[hacia] - (nuevoDesde + nuevoHacia) > MEJORA_MINIMA_METROS) {
            asignadas[desde] = sinElla;
            asignadas[hacia] = conElla;
            largos[desde] = nuevoDesde;
            largos[hacia] = nuevoHacia;
            mejoro = true;
            break;
          }
        }
      }
    }

    // Intercambiar dos reservas de naves distintas.
    for (let a = 0; a < naves.length; a += 1) {
      for (let b = a + 1; b < naves.length; b += 1) {
        for (const pa of [...asignadas[a]]) {
          if (!asignadas[a].includes(pa)) continue;
          for (const pb of [...asignadas[b]]) {
            if (libre(a) + pa.seats < pb.seats || libre(b) + pb.seats < pa.seats) continue;
            const nuevaA = [...asignadas[a].filter((item) => item !== pa), pb].sort(porCodigo);
            const nuevaB = [...asignadas[b].filter((item) => item !== pb), pa].sort(porCodigo);
            const largoA = largo(a, nuevaA);
            const largoB = largo(b, nuevaB);
            if (largos[a] + largos[b] - (largoA + largoB) > MEJORA_MINIMA_METROS) {
              asignadas[a] = nuevaA;
              asignadas[b] = nuevaB;
              largos[a] = largoA;
              largos[b] = largoB;
              mejoro = true;
              break;
            }
          }
        }
      }
    }

    if (!mejoro) break;
  }
  return { asignadas, sobrantes: reparto.sobrantes };
}

function largoTotal(reparto: Reparto, naves: NaveARepartir[], origen: PickupCoords) {
  return reparto.asignadas.reduce((total, paradas, indice) => total + largoDeNave(naves[indice].fijas, paradas, origen), 0);
}

/**
 * Reparte las paradas ubicadas entre las naves. Devuelve, por nave (mismo orden que `naves`), los códigos
 * que le tocan, y los que no entraron en ninguna.
 */
export function repartirPorZonas(
  paradas: ParadaARepartir[],
  naves: NaveARepartir[],
  origen: PickupCoords = AEROPUERTO_CHAPELCO
): { porNave: string[][]; sobrantes: string[] } {
  if (!naves.length) return { porNave: [], sobrantes: paradas.map((parada) => parada.code) };

  const candidatos = [repartoPorCorte(paradas, naves, origen), repartoPorZonas(paradas, naves)].map((inicial) => mejorar(inicial, naves, origen));
  // Gana el que deja menos gente afuera y, a igualdad, el recorrido más corto. En un empate queda el corte
  // de la recorrida, que es como se repartía antes: un reparto que ya estaba bien no cambia de nave.
  let mejor = candidatos[0];
  for (const candidato of candidatos.slice(1)) {
    const afuera = candidato.sobrantes.length - mejor.sobrantes.length;
    if (afuera < 0 || (afuera === 0 && largoTotal(candidato, naves, origen) + MEJORA_MINIMA_METROS < largoTotal(mejor, naves, origen))) {
      mejor = candidato;
    }
  }
  return {
    porNave: mejor.asignadas.map((asignadas) => asignadas.map((parada) => parada.code)),
    sobrantes: mejor.sobrantes.map((parada) => parada.code)
  };
}
