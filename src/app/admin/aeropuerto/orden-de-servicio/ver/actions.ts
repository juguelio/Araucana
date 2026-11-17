"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { recordEntityAuditAfterCommit } from "@/lib/audit/entity";
import { formatAuditDate } from "@/lib/audit/labels";
import { rangoDelDia } from "@/lib/airport/booking";
import { getAirportServiceOrderReservations } from "@/lib/airport/service-order-repository";
import { buildServiceOrderBlocks } from "@/lib/airport/service-order";

/**
 * Edición de la recorrida desde la orden de servicio: el operador arrastra a los pasajeros para fijar
 * el orden en que los busca (o los deja) la nave, y en un vuelo con varias naves los pasa de una a otra.
 *
 * Lo que se guarda vive en `AirportReservationDetails` (`routePosition`, `assignmentId`): la orden en
 * pantalla, el Excel y el link del chofer lo leen de ahí, así que los tres quedan iguales.
 */

export type RecorridoState = { error?: string; ok?: string };

const fecha = z.iso.date();
const codigos = z.array(z.string().min(1).max(40)).min(1).max(200);

const ORDEN_PATH = "/admin/aeropuerto/orden-de-servicio/ver";

/**
 * Las reservas pedidas, siempre que sean todas del vuelo y del día, de aeropuerto y no canceladas.
 * Si falta una, nadie toca nada: o se movió de vuelo mientras el operador miraba, o el pedido es ajeno.
 */
async function reservasDelVuelo(date: string, flightId: string, codes: string[]) {
  const { desde, hasta } = rangoDelDia(date);
  const detalles = await prisma.airportReservationDetails.findMany({
    where: {
      flightId,
      serviceDate: { gte: desde, lt: hasta },
      reservation: { code: { in: codes }, bookingMode: "AIRPORT", status: { not: "CANCELLED" } }
    },
    select: { id: true, assignmentId: true, routePosition: true, reservation: { select: { code: true } } }
  });
  const porCodigo = new Map(detalles.map((detalle) => [detalle.reservation.code, detalle]));
  return codes.every((code) => porCodigo.has(code)) ? porCodigo : null;
}

async function naveDelVuelo(flightId: string, assignmentId: string | null) {
  if (!assignmentId) return { name: null };
  const asignacion = await prisma.airportVehicleAssignment.findFirst({
    where: { id: assignmentId, flightId },
    select: { vehicle: { select: { name: true } } }
  });
  return asignacion ? { name: asignacion.vehicle.name } : null;
}

async function guardar(
  actor: Awaited<ReturnType<typeof getCurrentReservationsUserOrRedirect>>,
  { date, flightId, assignmentId, codes }: { date: string; flightId: string; assignmentId: string | null; codes: string[] }
): Promise<RecorridoState> {
  const [reservas, nave, vuelo] = await Promise.all([
    reservasDelVuelo(date, flightId, codes),
    naveDelVuelo(flightId, assignmentId),
    prisma.flight.findUnique({ where: { id: flightId }, select: { number: true, scheduledAt: true } })
  ]);
  if (!vuelo) return { error: "El vuelo ya no existe. Recargá la orden." };
  if (!nave) return { error: "Esa nave ya no está asignada al vuelo. Recargá la orden." };
  if (!reservas) return { error: "Algún pasajero cambió de vuelo o se canceló. Recargá la orden." };

  const antes = codes.map((code) => reservas.get(code)!);
  await prisma.$transaction(
    codes.map((code, indice) =>
      prisma.airportReservationDetails.update({
        where: { id: reservas.get(code)!.id },
        data: { routePosition: indice, assignmentId }
      })
    )
  );

  await recordEntityAuditAfterCommit(prisma, {
    actor,
    entity: "AIRPORT",
    entityId: flightId,
    entityLabel: `${vuelo.number} · ${formatAuditDate(vuelo.scheduledAt)}`,
    action: "UPDATE",
    summary: nave.name
      ? `Recorrida de la nave ${nave.name} ordenada a mano en la orden de servicio.`
      : "Recorrida ordenada a mano en la orden de servicio.",
    before: { recorrida: antes.map((detalle) => detalle.reservation.code).join(" → ") },
    after: { nave: nave.name, recorrida: codes.join(" → ") }
  });

  revalidatePath(ORDEN_PATH);
  return { ok: "Recorrida guardada." };
}

const guardarSchema = z.object({
  date: fecha,
  flightId: z.string().min(1),
  assignmentId: z.string().min(1).nullable(),
  codes: codigos
});

/** Fija el orden de una orden (una nave de un vuelo): el primero de la lista es la primera parada. */
export async function guardarRecorridoAction(input: z.input<typeof guardarSchema>): Promise<RecorridoState> {
  const actor = await getCurrentReservationsUserOrRedirect();
  const parsed = guardarSchema.safeParse(input);
  if (!parsed.success || new Set(parsed.data.codes).size !== parsed.data.codes.length) {
    return { error: "No se pudo leer el orden de la recorrida." };
  }
  return guardar(actor, parsed.data);
}

const moverSchema = z.object({
  date: fecha,
  flightId: z.string().min(1),
  assignmentId: z.string().min(1),
  code: z.string().min(1).max(40)
});

/**
 * Pasa un pasajero a otra nave del mismo vuelo y lo deja al final de esa recorrida. La nave de destino
 * queda con su orden fijado tal como se veía: si no, el reparto automático podría volver a mover gente.
 */
export async function moverANaveAction(input: z.input<typeof moverSchema>): Promise<RecorridoState> {
  const actor = await getCurrentReservationsUserOrRedirect();
  const parsed = moverSchema.safeParse(input);
  if (!parsed.success) return { error: "No se pudo mover al pasajero." };
  const { date, flightId, assignmentId, code } = parsed.data;

  const blocks = buildServiceOrderBlocks(await getAirportServiceOrderReservations(date, flightId), { incluirVacias: true });
  const destino = blocks.find((block) => block.vehicle?.assignmentId === assignmentId);
  if (!destino) return { error: "Esa nave ya no está asignada al vuelo. Recargá la orden." };

  const codes = [...destino.passengers.map((pasajero) => pasajero.code).filter((actual) => actual !== code), code];
  return guardar(actor, { date, flightId, assignmentId, codes });
}

const restablecerSchema = z.object({ date: fecha, flightId: z.string().min(1), codes: codigos });

/** Vuelve la orden al recorrido sugerido y al reparto automático entre naves. */
export async function restablecerRecorridoAction(input: z.input<typeof restablecerSchema>): Promise<RecorridoState> {
  const actor = await getCurrentReservationsUserOrRedirect();
  const parsed = restablecerSchema.safeParse(input);
  if (!parsed.success) return { error: "No se pudo restablecer la recorrida." };
  const { date, flightId, codes } = parsed.data;

  const [reservas, vuelo] = await Promise.all([
    reservasDelVuelo(date, flightId, codes),
    prisma.flight.findUnique({ where: { id: flightId }, select: { number: true, scheduledAt: true } })
  ]);
  if (!vuelo || !reservas) return { error: "Algún pasajero cambió de vuelo o se canceló. Recargá la orden." };

  await prisma.airportReservationDetails.updateMany({
    where: { id: { in: [...reservas.values()].map((detalle) => detalle.id) } },
    data: { routePosition: null, assignmentId: null }
  });
  await recordEntityAuditAfterCommit(prisma, {
    actor,
    entity: "AIRPORT",
    entityId: flightId,
    entityLabel: `${vuelo.number} · ${formatAuditDate(vuelo.scheduledAt)}`,
    action: "UPDATE",
    summary: "Recorrida devuelta al orden sugerido en la orden de servicio.",
    before: { recorrida: "a mano" },
    after: { recorrida: "sugerida" }
  });

  revalidatePath(ORDEN_PATH);
  return { ok: "Recorrida sugerida restablecida." };
}
