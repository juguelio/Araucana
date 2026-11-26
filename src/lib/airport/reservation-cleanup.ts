import { fuentesRetiradas } from "./data-quality";
import { prisma } from "@/lib/db/prisma";
import { recordAuditBestEffort } from "@/lib/audit/record";
import { withShortCode } from "@/lib/audit/reservation";

/**
 * Cierra las reservas de aeropuerto que quedaron abiertas cuando el vuelo ya pasó.
 *
 * Toda reserva nace en `PENDING_PAYMENT`. Si nadie la toca, queda así para siempre: en la base del
 * cliente había 14 reservas impagas de vuelos que ya habían volado, con lo que el estado dejaba de
 * significar algo. Y cuatro de ellas tenían el pago **aprobado**: plata cobrada, reserva sin
 * confirmar, porque nadie sincronizaba el pago con el estado del viaje.
 *
 * Dos reglas, en este orden:
 *
 * 1. Si el pago está aprobado, la reserva se confirma. El pago manda: la persona pagó.
 * 2. Si el vuelo ya pasó y nunca se aprobó el pago, la reserva se cancela. No se borra: queda el
 *    registro de que existió, y el operador puede volver a confirmarla si el pasajero viajó igual.
 *
 * Las reservas de vuelos futuros no se tocan: son plata que todavía se puede cobrar. Y
 * `DOCUMENTATION_PENDING` tampoco: ahí el pago ya se resolvió y falta la documentación.
 */

/** Margen después del horario del vuelo antes de dar una reserva por vencida. */
const HORAS_DE_GRACIA = 12;

export type ReconciliacionReservas = {
  confirmadas: number;
  canceladas: number;
};

export async function reconciliarReservasDeVuelosPasados(
  ahora: Date = new Date()
): Promise<ReconciliacionReservas> {
  const abiertas = await prisma.reservation.findMany({
    where: {
      status: "PENDING_PAYMENT",
      airportDetails: { isNot: null },
      payment: { isNot: null }
    },
    select: {
      id: true,
      code: true,
      shortCode: true,
      airportDetails: { select: { flight: { select: { scheduledAt: true, source: true } } } },
      payment: { select: { status: true } }
    }
  });

  const limite = new Date(ahora.getTime() - HORAS_DE_GRACIA * 3600000);
  const confirmar: string[] = [];
  const cancelar: string[] = [];
  const porId = new Map(abiertas.map((reserva) => [reserva.id, reserva]));

  for (const reserva of abiertas) {
    if (reserva.payment?.status === "APPROVED") {
      confirmar.push(reserva.id);
      continue;
    }
    const vuelo = reserva.airportDetails?.flight;
    if (vuelo && !fuentesRetiradas.includes(vuelo.source) && vuelo.scheduledAt < limite) cancelar.push(reserva.id);
  }

  if (confirmar.length > 0) {
    await prisma.reservation.updateMany({
      where: { id: { in: confirmar } },
      data: { status: "CONFIRMED" }
    });
  }
  if (cancelar.length > 0) {
    await prisma.reservation.updateMany({
      where: { id: { in: cancelar } },
      data: { status: "CANCELLED" }
    });
  }

  // Lo hace el sistema sin que nadie lo pida: cada reserva que cambió de estado queda con su fila.
  const anotar = async (ids: string[], action: "CONFIRM" | "CANCEL", status: string, summary: string) => {
    for (const id of ids) {
      const reserva = porId.get(id);
      await recordAuditBestEffort(prisma, {
        actor: null, action, entity: "RESERVATION", entityId: id, entityLabel: reserva?.code,
        summary: withShortCode(summary, reserva?.shortCode),
        changes: { status: { before: "PENDING_PAYMENT", after: status } }
      });
    }
  };
  await anotar(confirmar, "CONFIRM", "CONFIRMED", "Reserva confirmada automáticamente: el pago ya estaba aprobado.");
  await anotar(cancelar, "CANCEL", "CANCELLED", "Reserva cancelada automáticamente: el vuelo ya pasó y no tenía pago.");

  return { confirmadas: confirmar.length, canceladas: cancelar.length };
}
