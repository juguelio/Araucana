import type { Prisma } from "@prisma/client";
import { recordEntityAudit } from "./entity";
import type { AuditActor } from "./record";

const when = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  timeZone: "America/Argentina/Salta"
});

type ScheduleRow = {
  id: string; routeId: string; vehicleId: string; driverId?: string | null; departureAt: Date; arrivalAt: Date; status: string;
  /** Naves que se sumaron a la salida además de la principal. Sólo se compara si viene en los dos lados. */
  extraUnits?: Array<{ vehicleId: string; driverId: string | null }>;
};

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
  const extras = [...(before?.extraUnits ?? []), ...(after?.extraUnits ?? [])];
  const vehicleIds = [...new Set([before?.vehicleId, after?.vehicleId, ...extras.map((unit) => unit.vehicleId)].filter((id): id is string => !!id))];
  const vehicles = await tx.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, name: true } });
  const vehicleName = (id?: string) => (id ? vehicles.find((vehicle) => vehicle.id === id)?.name ?? id : null);
  // El chofer (issue #174) también por nombre: un id de usuario no le dice nada a quien lee.
  const driverIds = [...new Set([before?.driverId, after?.driverId, ...extras.map((unit) => unit.driverId)].filter((id): id is string => !!id))];
  const drivers = driverIds.length ? await tx.user.findMany({ where: { id: { in: driverIds } }, select: { id: true, name: true, email: true } }) : [];
  const driverName = (id?: string | null) => {
    if (!id) return null;
    const found = drivers.find((driver) => driver.id === id);
    return found ? found.name ?? found.email : id;
  };
  const picture = (row: ScheduleRow | null) => row && {
    departureAt: row.departureAt, arrivalAt: row.arrivalAt, status: row.status, routeId: row.routeId, vehicle: vehicleName(row.vehicleId),
    ...(row.driverId !== undefined ? { driver: driverName(row.driverId) } : {}),
    ...(row.extraUnits ? {
      extraUnits: row.extraUnits.length
        ? row.extraUnits.map((unit) => `${vehicleName(unit.vehicleId)} (${driverName(unit.driverId) ?? "sin chofer"})`).join("; ")
        : null
    } : {})
  };
  await recordEntityAudit(tx, {
    actor, entity: "SCHEDULE", entityId: reference.id, entityLabel: await scheduleAuditLabel(tx, reference),
    summary, before: picture(before), after: picture(after)
  });
}
