/**
 * Orden del viaje en el checkout de ida y vuelta (#189).
 *
 * Los dos tramos tienen sentido fijo —la llegada siempre es CPC → SMA y la salida siempre
 * SMA → CPC—, pero el pasajero puede llegar primero (ida y vuelta de un visitante) o irse primero
 * (un residente que sale y vuelve días después). El pedido del cliente es que las dos opciones se
 * vean al mismo tiempo y que elegir una no borre en silencio los vuelos ya cargados.
 */

export type OrdenDeViaje = "ARRIVAL" | "DEPARTURE";

export type OpcionDeOrden = {
  valor: OrdenDeViaje;
  titulo: string;
  ruta: string;
  ayuda: string;
};

/** Las dos opciones, en el orden en que se muestran. */
export const OPCIONES_DE_ORDEN: OpcionDeOrden[] = [
  {
    valor: "ARRIVAL",
    titulo: "Primero llego y después me voy",
    ruta: "CPC → SMA · SMA → CPC",
    ayuda: "Para quien llega de viaje y unos días después se va."
  },
  {
    valor: "DEPARTURE",
    titulo: "Primero me voy y después vuelvo",
    ruta: "SMA → CPC · CPC → SMA",
    ayuda: "Para quien sale de San Martín y vuelve unos días después."
  }
];

export type FechasDeTramos = { llegada: string; vuelta: string };

export type CambioDeOrden = {
  orden: OrdenDeViaje;
  fechas: FechasDeTramos;
  /** Hay que soltar los vuelos elegidos porque sus fechas se movieron. */
  limpiarVuelos: boolean;
  /** Texto para mostrarle al pasajero; vacío cuando no hay nada que avisar. */
  aviso: string;
};

/**
 * Cambia el orden del viaje sin perder nada en silencio.
 *
 * El tramo que va primero tiene que ser el más temprano en el calendario. Cuando el orden elegido
 * deja las fechas al revés, se dan vuelta las dos juntas (son los dos extremos del mismo viaje) y
 * se avisa que hay que volver a elegir los vuelos: los que estaban cargados eran de otras fechas.
 * Si las fechas siguen en orden, los vuelos se conservan tal cual.
 */
export function cambiarOrdenDeViaje(
  orden: OrdenDeViaje,
  nuevo: OrdenDeViaje,
  fechas: FechasDeTramos
): CambioDeOrden {
  if (nuevo === orden) {
    return { orden, fechas, limpiarVuelos: false, aviso: "" };
  }

  const primera = nuevo === "ARRIVAL" ? fechas.llegada : fechas.vuelta;
  const segunda = nuevo === "ARRIVAL" ? fechas.vuelta : fechas.llegada;
  if (!primera || !segunda || primera <= segunda) {
    return { orden: nuevo, fechas, limpiarVuelos: false, aviso: "" };
  }

  return {
    orden: nuevo,
    fechas: { llegada: fechas.vuelta, vuelta: fechas.llegada },
    limpiarVuelos: true,
    aviso: "Dimos vuelta las fechas para que el viaje tenga sentido. Elegí los vuelos otra vez."
  };
}
