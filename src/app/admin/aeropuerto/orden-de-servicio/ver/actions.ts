"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { recordEntityAuditAfterCommit } from "@/lib/audit/entity";
import { formatAuditDate } from "@/lib/audit/labels";
import { rangoDelDia } from "@/lib/airport/booking";
import { getAirportServiceOrder } from "@/lib/airport/service-order-data";

/**
 * Edición de la recorrida desde la orden de servicio: el operador arrastra a los pasajeros para fijar
 * el orden en que los busca (o los deja) la nave, y en un vuelo con varias naves los pasa de una a otra.
 *
 * Lo que se guarda vive en `AirportReservationDetails` (`routePosition`, `assignmentId`): la orden en
 * pantalla, el Excel y el link del chofer lo leen de ahí, así que los tres quedan iguales.
 */

export type RecorridoState = { error?: string; ok?: string };

const fecha = z.iso.date();
// Un código de reserva tiene 41 caracteres (`ARC-AAMM-` + 32 hexadecimales, ver `createReservationCode`):
// con el tope anterior de 40 se rechazaba todo cambio de la recorrida con «No se pudo leer…».
const codigo = z.string().min(1).max(64);
const codigos = z.array(codigo).min(1).max(200);

const ORDEN_PATH = "/admin/aeropuerto/orden-de-servicio/ver";

/**
 * Las reservas pedidas, siempre que sean todas del vuelo (o de los vuelos que la misma camioneta hace
 * en la misma vuelta) y del día, de aeropuerto y no canceladas. Si falta una, nadie toca nada: o se
 * movió de vuelo mientras el operador miraba, o el pedido es ajeno.
 */
async function reservasDelVuelo(date: string, flightIds: string[], codes: string[]) {
  const { desde, hasta } = rangoDelDia(date);
  const detalles = await prisma.airportReservationDetails.findMany({
    where: {
      flightId: { in: flightIds },
      serviceDate: { gte: desde, lt: hasta },
      reservation: { code: { in: codes }, bookingMode: "AIRPORT", status: { not: "CANCELLED" } }
    },
    select: { id: true, flightId: true, assignmentId: true, routePosition: true, reservation: { select: { code: true } } }
  });
  const porCodigo = new Map(detalles.map((detalle) => [detalle.reservation.code, detalle]));
  return codes.every((code) => porCodigo.has(code)) ? porCodigo : null;
}

/**
 * Los vuelos de la orden en la que está `flightId`: él solo, o todos los que la hoja une porque la
 * misma camioneta los hace en la misma vuelta (ver `unirVuelosCoordinados`).
 */
async function vuelosDeLaOrden(date: string, flightId: string) {
  const { blocks } = await getAirportServiceOrder(date, flightId, { incluirVacias: true });
  return blocks.find((block) => block.flightIds.length > 1 && block.flightIds.includes(flightId))?.flightIds ?? [flightId];
}

/**
 * La nave de destino y, para cada vuelo de la orden, su asignación de esa nave. En una vuelta unida la
 * misma trafic tiene un id de asignación por vuelo: cada pasajero se guarda con el de su propio vuelo.
 * Si su vuelo no tiene esa trafic (cada vuelo trajo la suya y se juntaron), se guarda la de la vuelta: la
 * hoja la reconoce mientras los vuelos sigan juntos, y no se crea una asignación que le sume cupo al vuelo.
 */
async function naveDelVuelo(flightIds: string[], assignmentId: string | null) {
  if (!assignmentId) return { name: null, porVuelo: new Map<string, string>() };
  const asignacion = await prisma.airportVehicleAssignment.findFirst({
    where: { id: assignmentId, flightId: { in: flightIds } },
    select: { vehicleId: true, vehicle: { select: { name: true } } }
  });
  if (!asignacion) return null;
  const deLaNave = await prisma.airportVehicleAssignment.findMany({
    where: { vehicleId: asignacion.vehicleId, flightId: { in: flightIds } },
    select: { id: true, flightId: true }
  });
  return { name: asignacion.vehicle.name, porVuelo: new Map(deLaNave.map((item) => [item.flightId, item.id])) };
}

async function guardar(
  actor: Awaited<ReturnType<typeof getCurrentReservationsUserOrRedirect>>,
  { date, flightId, assignmentId, codes }: { date: string; flightId: string; assignmentId: string | null; codes: string[] }
): Promise<RecorridoState> {
  // En una orden que une varios vuelos, la nave de cada pasajero se guarda con la asignación de su vuelo.
  const flightIds = await vuelosDeLaOrden(date, flightId);
  const [reservas, nave, vuelo] = await Promise.all([
    reservasDelVuelo(date, flightIds, codes),
    naveDelVuelo(flightIds, assignmentId),
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
        data: {
          routePosition: indice,
          assignmentId: assignmentId ? nave.porVuelo.get(reservas.get(code)!.flightId ?? "") ?? assignmentId : null
        }
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
  code: codigo
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

  const { blocks } = await getAirportServiceOrder(date, flightId, { incluirVacias: true });
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
    reservasDelVuelo(date, await vuelosDeLaOrden(date, flightId), codes),
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
