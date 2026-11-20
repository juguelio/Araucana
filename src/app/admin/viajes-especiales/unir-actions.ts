"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { recordEntityAudit } from "@/lib/audit/entity";
import { cadenaDeDias, motivoParaNoUnir, ultimoDia } from "@/lib/special-trips/rango";

class UnirError extends Error {}

/**
 * Une en un solo viaje de varios días los renglones que la planilla cargaba uno por día (mismo cliente,
 * mismo servicio, días seguidos). Queda el primero, con la vuelta en el último día; los demás se borran y
 * sus filas de origen pasan al que queda. Sólo si los días siguientes no tienen importe, cobros, naves ni
 * planillas propias: si los tienen, es un servicio que se cobra por día y no se toca.
 */
export async function unirViajesAction(formData: FormData) {
  const user = await getCurrentReservationsUserOrRedirect();
  const ids = formData.getAll("ids").map(String).filter(Boolean).slice(0, 60);
  const base = "/admin/viajes-especiales";
  if (ids.length < 2) redirect(base);
  let keepId = ids[0];
  let dias = 0;
  try {
    const result = await prisma.$transaction(async (tx) => {
      for (const id of [...ids].sort()) await tx.$queryRaw`SELECT id FROM "SpecialTrip" WHERE id = ${id} FOR UPDATE`;
      const trips = await tx.specialTrip.findMany({
        where: { id: { in: ids } },
        include: { _count: { select: { assignments: true, departureSheets: true } } }
      });
      if (trips.length !== ids.length) throw new UnirError("Alguno de los viajes ya no existe. Volvé a abrir la ficha.");
      const ordenados = [...trips].sort((a, b) => +a.serviceDate - +b.serviceDate);
      const [primero, ...siguientes] = ordenados;
      // Se vuelve a comprobar con lo que hay ahora: misma cadena de días seguidos y nada propio en los siguientes.
      if (cadenaDeDias(primero, ordenados).length !== ordenados.length) throw new UnirError("Los viajes ya no forman días seguidos del mismo servicio.");
      const motivo = motivoParaNoUnir(siguientes.map((t) => ({
        totalCents: t.totalCents, payments: t.payments, assignments: t._count.assignments, planillas: t._count.departureSheets, client: t.client
      })));
      if (motivo) throw new UnirError(motivo);

      const endDate = ordenados.reduce((max, t) => +ultimoDia(t) > +max ? ultimoDia(t) : max, ultimoDia(primero));
      const notas = [...new Set(ordenados.map((t) => t.notes?.trim()).filter((n): n is string => Boolean(n)))].join("\n").slice(0, 12000) || null;
      const updated = await tx.specialTrip.update({
        where: { id: primero.id },
        data: {
          endDate,
          passengers: primero.passengers ?? siguientes.find((t) => t.passengers)?.passengers ?? null,
          contact: primero.contact ?? siguientes.find((t) => t.contact)?.contact ?? null,
          notes: notas
        }
      });
      await tx.specialTripSource.updateMany({ where: { tripId: { in: siguientes.map((t) => t.id) } }, data: { tripId: primero.id } });
      await tx.specialTrip.deleteMany({ where: { id: { in: siguientes.map((t) => t.id) } } });
      const etiqueta = primero.client.slice(0, 120);
      const foto = ({ _count, ...resto }: (typeof ordenados)[number]) => (void _count, resto);
      await recordEntityAudit(tx, {
        actor: user, entity: "SPECIAL_TRIP", entityId: primero.id, entityLabel: etiqueta,
        summary: `Unido con ${siguientes.length} ${siguientes.length === 1 ? "día cargado aparte" : "días cargados aparte"}: un solo viaje de varios días.`,
        before: foto(primero), after: updated, json: ["legs", "payments"]
      });
      for (const t of siguientes) {
        await recordEntityAudit(tx, {
          actor: user, action: "DELETE", entity: "SPECIAL_TRIP", entityId: t.id, entityLabel: t.client.slice(0, 120),
          summary: `Unido al viaje ${primero.id} (renglón del ${t.serviceDate.toISOString().slice(0, 10)}).`, before: foto(t), after: null, json: ["legs", "payments"]
        });
      }
      return { id: primero.id, dias: Math.round((+endDate - +primero.serviceDate) / 86_400_000) + 1 };
    });
    keepId = result.id;
    dias = result.dias;
  } catch (error) {
    const mensaje = error instanceof UnirError ? error.message : "No pudimos unir los viajes. No se cambió nada.";
    redirect(`${base}/${keepId}?aviso=${encodeURIComponent(mensaje)}`);
  }
  revalidatePath(base);
  revalidatePath("/admin/salidas-del-dia");
  revalidatePath(`${base}/${keepId}`);
  redirect(`${base}/${keepId}?aviso=${encodeURIComponent(`Listo: es un solo viaje de ${dias} días.`)}`);
}
