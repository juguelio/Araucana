"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { rangoDelDia } from "@/lib/airport/booking";
import { DISABILITY_DOCUMENT_PROVIDER } from "@/lib/booking/disability-fare";

const schema = z.object({
  date: z.iso.date(),
  code: z.string().min(1).max(64),
  method: z.enum(["", "Efectivo", "Transferencia"])
});

/** Anota la forma de pago sin modificar importes ni dar el pago por aprobado. */
export async function guardarFormaDePagoAction(input: z.input<typeof schema>): Promise<{ error?: string; ok?: string }> {
  const actor = await getCurrentReservationsUserOrRedirect();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Elegí efectivo, transferencia o sin indicar." };
  const { date, code, method } = parsed.data;
  const { desde, hasta } = rangoDelDia(date);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const reserva = await tx.reservation.findFirst({
        where: {
          code, bookingMode: "AIRPORT", status: { not: "CANCELLED" },
          airportDetails: { is: { serviceDate: { gte: desde, lt: hasta } } }
        },
        select: { id: true, totalCents: true, currency: true, payment: { select: { method: true, provider: true } } }
      });
      if (!reserva) return { error: "La reserva cambió de día o se canceló. Recargá la orden." };
      if (reserva.payment?.provider === DISABILITY_DOCUMENT_PROVIDER || reserva.totalCents === 0) {
        return { error: "Esta reserva es sin cargo: no corresponde una forma de pago." };
      }
      const metodo = method || null;
      if ((reserva.payment?.method ?? null) !== metodo) {
        await tx.payment.upsert({
          where: { reservationId: reserva.id },
          update: { method: metodo },
          create: {
            reservationId: reserva.id, provider: "MANUAL", status: "PENDING",
            amountCents: reserva.totalCents, currency: reserva.currency, method: metodo
          }
        });
        await recordAudit(tx, {
          actor, entity: "RESERVATION", entityId: reserva.id, entityLabel: code, action: "UPDATE",
          summary: "Forma de pago anotada en la orden de servicio.",
          changes: { "payment.method": { before: reserva.payment?.method ?? null, after: metodo } }
        });
      }
      return { ok: "Forma de pago guardada." };
    });
    if (result.ok) {
      revalidatePath("/admin/aeropuerto/orden-de-servicio/ver");
      revalidatePath("/admin/reservas");
      revalidatePath(`/admin/reservas/${code}`);
      revalidatePath(`/admin/reservas/${code}/editar`);
    }
    return result;
  } catch {
    return { error: "No se pudo guardar la forma de pago. Volvé a intentar." };
  }
}
