import type { Prisma } from "@prisma/client";
import { recordEntityAudit } from "./entity";
import type { AuditActor } from "./record";

const when = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  timeZone: "America/Argentina/Salta"
});

type ScheduleRow = { id: string; routeId: string; vehicleId: string; departureAt: Date; arrivalAt: Date; status: string };

/** "Origen → Destino · 21/11/2026, 08:00": cómo se nombra una salida en la auditoría. */
export async function scheduleAuditLabel(tx: Prisma.TransactionClient, schedule: { routeId: string; departureAt: Date }) {
  const route = await tx.travelRoute.findUnique({ where: { id: schedule.routeId }, select: { from: true, to: true } });
  return `${route ? `${route.from} → ${route.to}` : "Salida"} · ${when.format(schedule.departureAt)}`;
}

/**
 * Alta, edición o baja de una salida, dentro de la transacción que la escribe. La nave se guarda
 * por nombre además del id, que es lo que alguien reconoce al leer la auditoría.
 */
export async function recordScheduleAudit(
  tx: Prisma.TransactionClient,
  actor: AuditActor | null | undefined,
  summary: string,
  before: ScheduleRow | null,
  after: ScheduleRow | null
) {
  const reference = after ?? before;
  if (!reference) return;
  const vehicleIds = [...new Set([before?.vehicleId, after?.vehicleId].filter((id): id is string => !!id))];
  const vehicles = await tx.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, name: true } });
  const vehicleName = (id?: string) => (id ? vehicles.find((vehicle) => vehicle.id === id)?.name ?? id : null);
  const picture = (row: ScheduleRow | null) => row && {
    departureAt: row.departureAt, arrivalAt: row.arrivalAt, status: row.status, routeId: row.routeId, vehicle: vehicleName(row.vehicleId)
  };
  await recordEntityAudit(tx, {
    actor, entity: "SCHEDULE", entityId: reference.id, entityLabel: await scheduleAuditLabel(tx, reference),
    summary, before: picture(before), after: picture(after)
  });
}
