import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

/**
 * Vuelos que hace una sola camioneta en la misma vuelta (`Flight.pickupGroupId`). Se arma desde
 * «Coordinar recorrida» (partidas) y «Juntar arribos»; la hoja del chofer une sus pasajeros en una
 * sola orden.
 *
 * - `juntar` con dos o más vuelos les da un grupo nuevo; con uno solo lo saca del grupo que tenía.
 * - Un grupo que queda con un solo vuelo se disuelve.
 * - Si cambia la composición de algún grupo, se borra el orden manual de la recorrida de los vuelos
 *   tocados: dos órdenes armadas a mano por separado no se pueden intercalar con sentido.
 */
export async function reagruparVuelos(tx: Prisma.TransactionClient, flightIds: string[], juntar: boolean) {
  const ids = [...new Set(flightIds)];
  const actuales = await tx.flight.findMany({ where: { id: { in: ids } }, select: { id: true, pickupGroupId: true } });
  const gruposViejos = [...new Set(actuales.flatMap((vuelo) => (vuelo.pickupGroupId ? [vuelo.pickupGroupId] : [])))];
  const miembrosViejos = gruposViejos.length
    ? await tx.flight.findMany({ where: { pickupGroupId: { in: gruposViejos } }, select: { id: true } })
    : [];
  const unir = juntar && ids.length >= 2;

  // Nada que cambiar: ya estaban todos (y sólo ellos) en el mismo grupo, o no estaban en ninguno.
  const mismoGrupo = unir && gruposViejos.length === 1 && actuales.every((vuelo) => vuelo.pickupGroupId === gruposViejos[0]) &&
    miembrosViejos.length === ids.length;
  if (mismoGrupo) return { cambio: false, grupo: gruposViejos[0] };
  if (!unir && gruposViejos.length === 0) return { cambio: false, grupo: null };

  const grupo = unir ? randomUUID() : null;
  await tx.flight.updateMany({ where: { id: { in: ids } }, data: { pickupGroupId: grupo } });
  for (const viejo of gruposViejos) {
    const quedan = await tx.flight.findMany({ where: { pickupGroupId: viejo }, select: { id: true } });
    if (quedan.length === 1) await tx.flight.update({ where: { id: quedan[0].id }, data: { pickupGroupId: null } });
  }
  const tocados = [...new Set([...ids, ...miembrosViejos.map((vuelo) => vuelo.id)])];
  await tx.airportReservationDetails.updateMany({ where: { flightId: { in: tocados } }, data: { routePosition: null } });
  return { cambio: true, grupo };
}

/** Los otros vuelos de la misma vuelta (sin el propio). */
export async function companerosDeRecorrida(tx: Prisma.TransactionClient, flight: { id: string; pickupGroupId: string | null }) {
  if (!flight.pickupGroupId) return [];
  const grupo = await tx.flight.findMany({ where: { pickupGroupId: flight.pickupGroupId, id: { not: flight.id } }, select: { id: true } });
  return grupo.map((vuelo) => vuelo.id);
}
