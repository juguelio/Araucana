import type { Prisma } from "@prisma/client";
import { butacasParaAeropuerto } from "./capacity";

export const CAPACIDAD_POR_VUELO = 24;

type Reserva = { passengerCount: number; status: string };

export function pasajerosOcupados(reservas: readonly Reserva[]): number {
  return reservas.filter((reserva) => reserva.status !== "CANCELLED")
    .reduce((total, reserva) => total + reserva.passengerCount, 0);
}

export function capacidadDeVuelo(combis: ReadonlyArray<{ seats: number }>): number {
  if (combis.length === 0) return CAPACIDAD_POR_VUELO;
  return combis.reduce((total, combi) => total + butacasParaAeropuerto(combi.seats), 0);
}

export const incluirCupoDelVuelo = {
  reservations: {
    where: { isPrivate: false },
    select: { reservationId: true, reservation: { select: { passengerCount: true, status: true } } }
  },
  assignments: {
    where: { privateReservationId: null },
    select: { vehicleId: true, vehicle: { select: { seats: { select: { id: true } } } } }
  }
} satisfies Prisma.FlightInclude;

type VueloConCupo = {
  direction: string;
  pickupGroupId: string | null;
  reservations: ReadonlyArray<{ reservationId: string; isPrivate?: boolean; reservation: Reserva }>;
  assignments: ReadonlyArray<{ vehicleId: string; privateReservationId?: string | null; vehicle: { seats: readonly unknown[] } }>;
};

/** Una recorrida usa cada nave pública una sola vez. El cupo provisorio de 24 se aplica a la vuelta entera. */
export function cupoDeRecorrida(vuelos: readonly VueloConCupo[], excluirReservaId?: string) {
  const reservas = vuelos.flatMap((vuelo) => vuelo.reservations)
    .filter((detalle) => !detalle.isPrivate && (!excluirReservaId || detalle.reservationId !== excluirReservaId));
  const ocupados = pasajerosOcupados(reservas.map((detalle) => detalle.reservation));
  const asignaciones = vuelos.flatMap((vuelo) => vuelo.assignments).filter((asignacion) => !asignacion.privateReservationId);
  const naves = [...new Map(asignaciones.map((asignacion) => [
    asignacion.vehicleId, { seats: asignacion.vehicle.seats.length }
  ])).values()];
  const capacidad = capacidadDeVuelo(naves);
  const lugaresAsignados = naves.length ? capacidad : 0;
  return { ocupados, capacidad, lugaresAsignados, naves: naves.length, disponibles: Math.max(0, capacidad - ocupados), faltan: Math.max(0, ocupados - capacidad) };
}

type ClienteDeVuelos = Pick<Prisma.TransactionClient, "flight">;
type ClaveDeRecorrida = Pick<VueloConCupo, "pickupGroupId" | "direction">;
const claveDeRecorrida = (vuelo: ClaveDeRecorrida) => `${vuelo.pickupGroupId}:${vuelo.direction}`;

/** Lee de a un lote los miembros, incluso cuando un filtro del tablero oculta alguno. */
export async function cargarMiembrosDeRecorridas(db: ClienteDeVuelos, vuelos: readonly ClaveDeRecorrida[]) {
  const ids = [...new Set(vuelos.flatMap((vuelo) => vuelo.pickupGroupId ? [vuelo.pickupGroupId] : []))];
  const miembros = new Map<string, VueloConCupo[]>();
  if (ids.length) {
    const filas = await db.flight.findMany({ where: { pickupGroupId: { in: ids } }, include: incluirCupoDelVuelo });
    for (const fila of filas) {
      const clave = claveDeRecorrida(fila);
      const grupo = miembros.get(clave) ?? [];
      grupo.push(fila);
      miembros.set(clave, grupo);
    }
  }
  return (vuelo: VueloConCupo) => (vuelo.pickupGroupId ? miembros.get(claveDeRecorrida(vuelo)) : undefined) ?? [vuelo];
}

export async function leerCupoDeRecorrida(db: ClienteDeVuelos, vuelo: VueloConCupo, excluirReservaId?: string) {
  const miembros = await cargarMiembrosDeRecorridas(db, [vuelo]);
  return cupoDeRecorrida(miembros(vuelo), excluirReservaId);
}
