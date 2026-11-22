/**
 * Las reservas que quedaron encima de un vuelo que ninguna fuente confirma (#331).
 *
 * El aviso del tablero decía cuántas eran, pero no cuáles: con seis reservas repartidas en un día de
 * veinte, el operador no tenía forma de encontrarlas —el listado de reservas no filtra por vuelo— y
 * terminaba abriéndolas una por una. Acá se arma la lista, agrupada por vuelo y ordenada por hora,
 * con lo mínimo para reconocerla y un link directo a la pantalla donde se cambia el vuelo.
 *
 * El criterio de «vuelo fantasma» **no** es `Flight.status`: es `source = "ESTIMADO"` con
 * `lastCheckedAt` en null (ver `esProyeccion` en `./flight-board`). Todos los vuelos de un día pueden
 * estar `SCHEDULED` o `EN_ROUTE` y aun así ser una proyección; lo que decide es que ninguna fuente lo
 * haya verificado todavía. Y los identificadores de la reserva que se dictan son `shortCode`, no
 * `code`: `code` es la capability que abre la reserva, `shortCode` es el que se lee por teléfono.
 */

export type VueloFantasmaDelDia = {
  id: string;
  number: string;
  direction: string;
  /** Hora del vuelo proyectado, ya formateada (`hh:mm`). */
  hora: string;
  /** Ids de las reservas que cuelgan de este vuelo. */
  reservas: readonly string[];
};

export type DetalleReservaFantasma = {
  id: string;
  code: string;
  shortCode: string;
  status: string;
  passengerCount: number;
  pasajero: string;
};

export type FilaReservaFantasma = {
  reservaId: string;
  flightId: string;
  vuelo: string;
  sentido: string;
  hora: string;
  code: string;
  shortCode: string;
  pasajero: string;
  passengerCount: number;
  estado: string;
};

const estadosLegibles: Record<string, string> = {
  PENDING_PAYMENT: "Pago pendiente",
  DOCUMENTATION_PENDING: "Falta documentación",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
  PENDING: "Pendiente",
  PAID: "Pagada"
};

/** El estado tal como lo lee el operador. Los estados nuevos se muestran crudos, nunca se pierden. */
export function estadoLegible(status: string) {
  return estadosLegibles[status] ?? status;
}

/**
 * Una fila por reserva fantasma. Una reserva que ya no existe (se borró entre la consulta del vuelo
 * y la del detalle) se saltea en silencio: la lista es informativa, no un inventario.
 */
export function reservasFantasmaDelDia(
  vuelos: readonly VueloFantasmaDelDia[],
  detalle: readonly DetalleReservaFantasma[]
): FilaReservaFantasma[] {
  const porId = new Map(detalle.map((reserva) => [reserva.id, reserva]));
  return vuelos
    .flatMap((vuelo) => vuelo.reservas.flatMap((reservaId) => {
      const reserva = porId.get(reservaId);
      if (!reserva) return [];
      return [{
        reservaId: reserva.id,
        flightId: vuelo.id,
        vuelo: vuelo.number,
        sentido: vuelo.direction,
        hora: vuelo.hora,
        code: reserva.code,
        shortCode: reserva.shortCode,
        pasajero: reserva.pasajero,
        passengerCount: reserva.passengerCount,
        estado: estadoLegible(reserva.status)
      }];
    }))
    .sort((a, b) => a.hora.localeCompare(b.hora) || a.shortCode.localeCompare(b.shortCode, "es"));
}

/** Agrupa las filas por vuelo, en el orden en que se van a dibujar. */
export function reservasFantasmaPorVuelo(filas: readonly FilaReservaFantasma[]) {
  const grupos = new Map<string, { vuelo: string; sentido: string; hora: string; filas: FilaReservaFantasma[] }>();
  for (const fila of filas) {
    const grupo = grupos.get(fila.flightId) ?? { vuelo: fila.vuelo, sentido: fila.sentido, hora: fila.hora, filas: [] };
    grupo.filas.push(fila);
    grupos.set(fila.flightId, grupo);
  }
  return [...grupos.values()];
}
