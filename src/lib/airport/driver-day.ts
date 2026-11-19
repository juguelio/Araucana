import type { OrdenElegida } from "./flight-selection";
import { lugaresDeLaOrden, referenciaDeLaOrden, type ServiceOrderBlock } from "./service-order";

/**
 * El día de cada combi en el aeropuerto: sus órdenes OUT (partidas, que terminan en el aeropuerto) e IN
 * (arribos, que salen de ahí), en el orden en que las hace. El emparejamiento sale de la asignación: la
 * combi que hace el OUT de una recorrida y está asignada a un arribo hace ese IN después (pedido del
 * cliente, 19/11). Con eso se imprime la hoja IN/OUT de cada chofer.
 */
export type TramoDeLaCombi = {
  direction: "ARRIVAL" | "DEPARTURE";
  /** Cuándo arranca la recorrida (OUT) o cuándo llega el vuelo (IN). */
  hora: Date;
  /** «JA3184 + AR1657». */
  vuelos: string;
  flightIds: string[];
  pasajeros: number;
  chofer: string | null;
  choferId: string | null;
  /** La orden puntual, para abrirla o imprimirla. */
  orden: OrdenElegida;
};

export type JornadaDeCombi = {
  vehicleId: string;
  nave: string;
  /** Los choferes de sus órdenes, sin repetir (normalmente uno). */
  choferes: string[];
  /** El chofer de su última orden, para sumarle el próximo IN con el mismo. */
  choferId: string | null;
  tramos: TramoDeLaCombi[];
  /** Hace un OUT y después no tiene ningún IN: vuelve vacía del aeropuerto. */
  sinIn: boolean;
};

/** Agrupa las órdenes del día por combi. Las órdenes sin nave o sin pasajeros quedan afuera. */
export function jornadasPorCombi(blocks: ServiceOrderBlock[]): JornadaDeCombi[] {
  const porCombi = new Map<string, JornadaDeCombi>();
  for (const block of blocks) {
    if (!block.vehicle || !block.flightId || !block.passengers.length) continue;
    const tramo: TramoDeLaCombi = {
      direction: block.direction,
      hora: block.direction === "DEPARTURE" ? block.operationAt : block.flightAt,
      vuelos: block.flightNumber,
      flightIds: block.flightIds,
      pasajeros: lugaresDeLaOrden(block),
      chofer: block.vehicle.driver,
      choferId: block.vehicle.driverId ?? null,
      orden: { flight: block.flightId, vehicle: referenciaDeLaOrden(block).vehicle }
    };
    const jornada = porCombi.get(block.vehicle.vehicleId) ?? {
      vehicleId: block.vehicle.vehicleId, nave: block.vehicle.name, choferes: [], choferId: null, tramos: [], sinIn: false
    };
    jornada.tramos.push(tramo);
    porCombi.set(block.vehicle.vehicleId, jornada);
  }

  const jornadas = [...porCombi.values()].map((jornada) => {
    const tramos = [...jornada.tramos].sort((a, b) => a.hora.getTime() - b.hora.getTime());
    const ultimoOut = [...tramos].reverse().find((tramo) => tramo.direction === "DEPARTURE");
    return {
      ...jornada,
      tramos,
      choferes: [...new Set(tramos.flatMap((tramo) => (tramo.chofer ? [tramo.chofer] : [])))],
      choferId: tramos.at(-1)?.choferId ?? null,
      sinIn: Boolean(ultimoOut) && !tramos.some((tramo) => tramo.direction === "ARRIVAL" && tramo.hora >= ultimoOut!.hora)
    };
  });
  return jornadas.sort((a, b) => a.tramos[0].hora.getTime() - b.tramos[0].hora.getTime() || a.nave.localeCompare(b.nave));
}
