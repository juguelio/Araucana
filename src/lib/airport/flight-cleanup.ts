import { prisma } from "@/lib/db/prisma";

/**
 * Borra una fila de vuelo sólo si sigue sin reservas ni combis.
 *
 * Un DELETE con NOT EXISTS no alcanza: en READ COMMITTED puede tomar su snapshot antes de que
 * termine un alta concurrente, esperar su FK y después borrar igual (SET NULL / CASCADE).
 * FOR UPDATE espera esas altas y bloquea las nuevas. La sentencia siguiente ve sus relaciones
 * ya confirmadas; ambas operaciones comparten la misma transacción y el bloqueo se conserva.
 */
export async function deleteUnoccupiedFlight(id: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Flight" WHERE id = ${id} FOR UPDATE`;
    if (rows.length === 0) return 0;
    const { count } = await tx.flight.deleteMany({
      where: { id, reservations: { none: {} }, assignments: { none: {} } }
    });
    return count;
  }, { isolationLevel: "ReadCommitted" });
}
