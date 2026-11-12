import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { elegirAutoritativa, elegirSuperviviente, type FilaDeVuelo } from "./dedupe";

/**
 * Unificación de una fila repetida de JetSMART (issue #76).
 *
 * El planificador elige qué fila queda, pero borrar la otra sin más pierde lo que esa fila sabía:
 * el tablero puede tener el vuelo cancelado, el horario nuevo, una nota de coordinación o los
 * eventos de imprevisto. Como la reserva queda apuntando a la fila que sobrevive, un borrado seco
 * deja al pasajero con un vuelo "programado" que en realidad está cancelado.
 *
 * Por eso acá, en una sola transacción: se bloquean las filas, se borran las que siguen sin
 * reservas ni combis, se trasladan sus eventos y, si la fila descartada era la más confiable (el
 * tablero le gana a la proyección), se copian sus datos operativos a la que queda. Los datos que
 * escribió una persona a mano (notas, recorrida coordinada) no se pisan si la que queda ya los
 * tiene.
 *
 * Igual que el borrado, nunca toca una fila con reservas o combis.
 */
export type ResultadoUnificacion = { borrados: number; eventos: number };

const CAMPOS = {
  id: true,
  number: true,
  direction: true,
  scheduledAt: true,
  source: true,
  updatedAt: true,
  status: true,
  estimatedAt: true,
  actualAt: true,
  externalId: true,
  airline: true,
  origin: true,
  destination: true,
  lastCheckedAt: true,
  notes: true,
  pickupStartOverrideAt: true,
  passengers: true,
  _count: { select: { reservations: true, assignments: true } }
} satisfies Prisma.FlightSelect;

type Fila = Prisma.FlightGetPayload<{ select: typeof CAMPOS }>;

const comoPrioridad = (f: Fila): FilaDeVuelo => ({
  id: f.id,
  number: f.number,
  direction: f.direction,
  dia: "",
  source: f.source,
  updatedAt: f.updatedAt,
  reservas: f._count.reservations,
  combis: f._count.assignments
});

export async function unificarFilasDeVuelo(
  ids: readonly string[],
  aBorrar: readonly string[]
): Promise<ResultadoUnificacion> {
  const grupo = [...new Set(ids)];
  const candidatos = [...new Set(aBorrar)].filter((id) => grupo.includes(id));
  if (candidatos.length === 0) return { borrados: 0, eventos: 0 };

  return prisma.$transaction(async (tx) => {
    // Orden estable para que dos sync simultáneos no se bloqueen mutuamente.
    for (const id of [...grupo].sort()) {
      await tx.$queryRaw`SELECT id FROM "Flight" WHERE id = ${id} FOR UPDATE`;
    }

    const filas = await tx.flight.findMany({ where: { id: { in: grupo } }, select: CAMPOS });
    const prioridad = filas.map(comoPrioridad);
    const sobreviviente = elegirSuperviviente(prioridad);
    if (!sobreviviente) return { borrados: 0, eventos: 0 };
    const autoritativa = elegirAutoritativa(prioridad);
    const perdedores = candidatos.filter((id) => id !== sobreviviente.id);

    // El borrado arrastra los eventos (`onDelete: Cascade`), así que se leen antes para recrearlos
    // en la fila que queda: se conserva el historial y el estado de aviso, sin volver a avisar.
    const eventosDePerdedores = await tx.flightEvent.findMany({
      where: { flightId: { in: perdedores } },
      select: { flightId: true, kind: true, fromValue: true, toValue: true, detectedAt: true, notifiedAt: true }
    });

    // La condición se repite en el borrado: si entre la lectura y acá entró una reserva, no se borra.
    const borrados: string[] = [];
    for (const id of perdedores) {
      const { count } = await tx.flight.deleteMany({
        where: { id, reservations: { none: {} }, assignments: { none: {} } }
      });
      if (count > 0) borrados.push(id);
    }

    let eventos = 0;
    if (borrados.length > 0) {
      const aRecrear = eventosDePerdedores.filter((evento) => borrados.includes(evento.flightId));
      if (aRecrear.length > 0) {
        await tx.flightEvent.createMany({
          data: aRecrear.map(({ flightId: _descartada, ...evento }) => ({ ...evento, flightId: sobreviviente.id }))
        });
        eventos = aRecrear.length;
      }
    }

    const fuente = autoritativa ? filas.find((f) => f.id === autoritativa.id) : undefined;
    const destino = filas.find((f) => f.id === sobreviviente.id);
    // Sólo se copia si desapareció la fila de la que se copia y no quedó ninguna protegida: así no
    // aparecen dos filas con el mismo número, horario y sentido.
    if (fuente && destino && fuente.id !== destino.id && borrados.includes(fuente.id) && borrados.length === perdedores.length) {
      await tx.flight.update({
        where: { id: destino.id },
        data: {
          status: fuente.status,
          scheduledAt: fuente.scheduledAt,
          estimatedAt: fuente.estimatedAt,
          actualAt: fuente.actualAt,
          source: fuente.source,
          externalId: fuente.externalId,
          airline: fuente.airline,
          origin: fuente.origin,
          destination: fuente.destination,
          lastCheckedAt: fuente.lastCheckedAt,
          notes: destino.notes ?? fuente.notes,
          pickupStartOverrideAt: destino.pickupStartOverrideAt ?? fuente.pickupStartOverrideAt,
          passengers: destino.passengers ?? fuente.passengers
        }
      });
    }

    return { borrados: borrados.length, eventos };
  }, { isolationLevel: "ReadCommitted" });
}
