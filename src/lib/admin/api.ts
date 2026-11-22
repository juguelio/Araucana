import type { Prisma } from "@prisma/client";
import type { AuditActor } from "@/lib/audit/record";
import { listChange, recordEntityAudit } from "@/lib/audit/entity";
import { recordScheduleAudit } from "@/lib/audit/schedule";

/** Quien llama a la API: la sesión que validó `requireAdminApi`. Va a la auditoría de cada escritura. */
type ApiActor = AuditActor & { id: string };
const VIA_API = " (por la API)";
const routeLabel = (route: { from: string; to: string }) => `${route.from} → ${route.to}`;
import { lockFleet, savePublicSchedule } from "@/lib/special-trips/conflicts";
import { primaryVehicleProblem } from "@/lib/booking/schedule-unit-service";
import { z, type ZodError } from "zod";
import { ApiError, type ApiErrorFields } from "@/lib/api/responses";
import { approveManualPayment, getReservationByCode, listAdminReservations, listAdminRoutes, listAdminSchedules, updatePassengerForReservation } from "@/lib/booking/repository";
import { getStopFares } from "@/lib/booking/stop-fares";
import { adminPassengerSchema } from "@/lib/booking/validation";
import { prisma } from "@/lib/db/prisma";
import { getVehicleTemplate } from "@/lib/vehicles/templates";

const scheduleStatuses = ["OPEN", "DOCUMENTATION", "CLOSED"] as const;

const requiredString = z.string().trim().min(1);
const optionalNullableString = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((value) => value || null);

const stopSchema = z.object({
  name: requiredString,
  km: z.coerce.number().nonnegative().default(0),
  minutes: z.coerce.number().nonnegative().default(0),
  note: z.string().trim().default(""),
  priceCents: z.number().int().positive().optional()
});

const seatSchema = z.object({
  number: requiredString,
  row: z.coerce.number().int().nonnegative(),
  column: z.coerce.number().int().nonnegative()
});

function slugify(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function isoDateSchema(fieldName: string) {
  return z.string().transform((value, context) => {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      context.addIssue({
        code: "custom",
        message: `${fieldName} debe ser una fecha ISO valida.`
      });
      return z.NEVER;
    }

    return date;
  });
}

export const adminRouteInputSchema = z
  .object({
    slug: z.string().trim().optional().nullable(),
    from: requiredString,
    to: requiredString,
    via: requiredString,
    durationMin: z.coerce.number().int().positive(),
    priceCents: z.coerce.number().int().positive(),
    currency: z.string().trim().min(3).default("ARS"),
    category: z.string().trim().min(1).default("Argentina"),
    description: z.string().trim().default(""),
    featured: z.coerce.boolean().default(false),
    isActive: z.coerce.boolean().default(true),
    stops: z.array(stopSchema).default([])
  })
  .superRefine((input, context) => {
    const pricedStops = input.stops.filter((stop) => stop.priceCents !== undefined);
    if (getStopFares(input).length !== pricedStops.length) {
      context.addIssue({ code: "custom", path: ["stops"], message: "Usá nombres distintos en las paradas intermedias y una tarifa menor que la ruta completa." });
    }
  })
  .transform((input) => ({
    ...input,
    slug: input.slug?.trim() || slugify(`${input.from}-${input.to}-${input.via}`)
  }));

export const adminScheduleInputSchema = z.object({
  routeId: requiredString,
  vehicleId: requiredString,
  departureAt: isoDateSchema("departureAt"),
  status: z.enum(scheduleStatuses).default("OPEN"),
  confirmation: z.string().max(20000).optional()
});

export const adminScheduleStatusSchema = z.object({
  status: z.enum(scheduleStatuses),
  confirmation: z.string().max(20000).optional()
});

export const adminVehicleInputSchema = z
  .object({
    name: requiredString,
    brand: requiredString,
    model: requiredString,
    licensePlate: optionalNullableString,
    templateKey: optionalNullableString,
    isActive: z.coerce.boolean().default(true),
    seats: z.array(seatSchema).min(1)
  })
  .superRefine((input, context) => {
    if (input.templateKey && !getVehicleTemplate(input.templateKey)) {
      context.addIssue({
        code: "custom",
        path: ["templateKey"],
        message: "La plantilla seleccionada ya no existe."
      });
    }
  });

export const adminReservationPassengerUpdateSchema = z.object({
  passenger: adminPassengerSchema
});

export function normalizeReservationCode(code: string) {
  return code.trim().toUpperCase();
}

export function fieldsFromZodError(error: ZodError): ApiErrorFields {
  const fields: ApiErrorFields = {};

  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (path && !fields[path]) {
      fields[path] = issue.message;
    }
  }

  return fields;
}

export function parseAdminPayload<T>(schema: z.ZodType<T>, payload: unknown, message = "Revisa los campos enviados.") {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiError("VALIDATION_ERROR", message, 422, fieldsFromZodError(parsed.error));
  }

  return parsed.data;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function routeSelect() {
  return {
    id: true,
    slug: true,
    from: true,
    to: true,
    via: true,
    description: true,
    category: true,
    featured: true,
    isActive: true,
    durationMin: true,
    priceCents: true,
    currency: true,
    stops: true
  };
}

function vehicleInclude() {
  return {
    seats: {
      orderBy: [{ row: "asc" as const }, { column: "asc" as const }, { number: "asc" as const }]
    }
  };
}

function scheduleInclude() {
  return {
    route: true,
    vehicle: {
      include: {
        seats: true
      }
    },
    // Las naves que se sumaron a la salida, en orden, con su chofer.
    extraUnits: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }], include: { vehicle: true, driver: { select: { id: true, name: true } } } },
    reservations: true
  };
}

async function getRouteDuration(routeId: string) {
  const route = await prisma.travelRoute.findUnique({
    where: { id: routeId },
    select: { durationMin: true }
  });

  if (!route) {
    throw new ApiError("ROUTE_NOT_FOUND", "Ruta no encontrada", 404);
  }

  return route.durationMin;
}

export async function listAdminApiRoutes() {
  return listAdminRoutes();
}

export async function getAdminApiRoute(id: string) {
  const route = await prisma.travelRoute.findUnique({
    where: { id },
    select: routeSelect()
  });

  if (!route) {
    throw new ApiError("ROUTE_NOT_FOUND", "Ruta no encontrada", 404);
  }

  return {
    ...route,
    price: route.priceCents / 100
  };
}

export async function createAdminApiRoute(payload: unknown, actor?: ApiActor | null) {
  const data = parseAdminPayload(adminRouteInputSchema, payload);
  const route = await prisma.$transaction(async (tx) => {
    const created = await tx.travelRoute.create({ data });
    await recordEntityAudit(tx, { actor, entity: "ROUTE", entityId: created.id, entityLabel: routeLabel(created), summary: `Ruta creada${VIA_API}.`, after: created, json: ["stops"] });
    return created;
  });
  return getAdminApiRoute(route.id);
}

/** Edita la ruta y deja la auditoría en la misma transacción. */
async function updateRouteAudited(id: string, data: Prisma.TravelRouteUpdateInput, summary: string, actor?: ApiActor | null) {
  await prisma.$transaction(async (tx) => {
    const before = await tx.travelRoute.findUnique({ where: { id } });
    const after = await tx.travelRoute.update({ where: { id }, data });
    await recordEntityAudit(tx, { actor, entity: "ROUTE", entityId: id, entityLabel: routeLabel(after), summary, before, after, json: ["stops"] });
  });
}

export async function updateAdminApiRoute(id: string, payload: unknown, actor?: ApiActor | null) {
  const data = parseAdminPayload(adminRouteInputSchema, payload);
  await updateRouteAudited(id, data, `Ruta editada${VIA_API}.`, actor);
  return getAdminApiRoute(id);
}

export async function patchAdminApiRoute(id: string, payload: unknown, actor?: ApiActor | null) {
  const activeOnly = z.object({ isActive: z.coerce.boolean() }).safeParse(payload);

  if (activeOnly.success && Object.keys(payload as Record<string, unknown>).length === 1) {
    await updateRouteAudited(id, { isActive: activeOnly.data.isActive }, `${activeOnly.data.isActive ? "Ruta activada" : "Ruta inactivada"}${VIA_API}.`, actor);
    return getAdminApiRoute(id);
  }

  return updateAdminApiRoute(id, payload, actor);
}

export async function deleteAdminApiRoute(id: string, actor?: ApiActor | null) {
  const route = await prisma.travelRoute.findUnique({ where: { id } });
  if (!route) {
    throw new ApiError("ROUTE_NOT_FOUND", "Ruta no encontrada", 404);
  }

  const reservations = await prisma.reservation.count({
    where: {
      schedule: {
        routeId: id
      }
    }
  });

  if (reservations > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.travelRoute.update({ where: { id }, data: { isActive: false } });
      const closed = await tx.schedule.updateMany({ where: { routeId: id, status: { not: "CLOSED" } }, data: { status: "CLOSED" } });
      await recordEntityAudit(tx, {
        actor, entity: "ROUTE", entityId: id, entityLabel: routeLabel(route), action: "UPDATE",
        summary: `Ruta archivada porque ya tenía reservas; se cerraron ${closed.count} salidas${VIA_API}.`,
        before: { isActive: route.isActive }, after: { isActive: false },
        extra: closed.count ? { closedSchedules: { before: 0, after: closed.count } } : undefined
      });
    });
    return { archived: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.travelRoute.delete({ where: { id } });
    await recordEntityAudit(tx, { actor, entity: "ROUTE", entityId: id, entityLabel: routeLabel(route), summary: `Ruta borrada${VIA_API}.`, before: route, json: ["stops"] });
  });
  return { deleted: true };
}

export async function listAdminApiSchedules() {
  return listAdminSchedules();
}

export async function getAdminApiSchedule(id: string) {
  const schedule = await prisma.schedule.findUnique({
    where: { id },
    include: scheduleInclude()
  });

  if (!schedule) {
    throw new ApiError("SCHEDULE_NOT_FOUND", "Salida no encontrada", 404);
  }

  return schedule;
}

async function persistAdminApiSchedule(
  data: { routeId: string; vehicleId: string; departureAt: Date; arrivalAt: Date; status: string },
  actor: ApiActor,
  confirmation?: string,
  id?: string,
  statusOnly = false
) {
  const result = await prisma.$transaction(async (tx) => {
    const before = id ? await tx.schedule.findUnique({ where: { id } }) : null;
    const problem = id && !statusOnly ? await primaryVehicleProblem(tx, id, data.vehicleId) : null;
    if (problem) throw new ApiError("VEHICLE_NOT_AVAILABLE", problem, 409);
    const saved = await savePublicSchedule(tx, data, actor.id, confirmation ?? "", id, statusOnly);
    if ("id" in saved && saved.id) {
      const summary = `${!id ? "Salida creada" : statusOnly ? "Estado de la salida cambiado" : "Salida editada"}${VIA_API}.`;
      await recordScheduleAudit(tx, actor, summary, before, await tx.schedule.findUnique({ where: { id: saved.id } }));
    }
    return saved;
  });
  if (result.conflicts) {
    throw new ApiError("FLEET_CONFLICT", "La nave ya está tomada en ese horario.", 409, {
      confirmation: result.confirmation, conflicts: JSON.stringify(result.conflicts)
    });
  }
  return getAdminApiSchedule(result.id);
}

async function saveAdminApiSchedule(payload: unknown, actor: ApiActor, id?: string) {
  const { confirmation, ...input } = parseAdminPayload(adminScheduleInputSchema, payload);
  const durationMin = await getRouteDuration(input.routeId);
  return persistAdminApiSchedule({ ...input, arrivalAt: addMinutes(input.departureAt, durationMin) }, actor, confirmation, id);
}

export async function createAdminApiSchedule(payload: unknown, actor: ApiActor) {
  return saveAdminApiSchedule(payload, actor);
}

export async function patchAdminApiSchedule(id: string, payload: unknown, actor: ApiActor) {
  if (payload && typeof payload === "object" && Object.keys(payload).every((key) => ["status", "confirmation"].includes(key))) {
    const { status, confirmation } = parseAdminPayload(adminScheduleStatusSchema, payload);
    const current = await getAdminApiSchedule(id);
    const { routeId, vehicleId, departureAt, arrivalAt } = current;
    return persistAdminApiSchedule({ routeId, vehicleId, departureAt, arrivalAt, status }, actor, confirmation, id, true);
  }
  return saveAdminApiSchedule(payload, actor, id);
}

export async function deleteAdminApiSchedule(id: string, actor?: ApiActor | null) {
  const schedule = await prisma.schedule.findUnique({ where: { id } });
  if (!schedule) {
    throw new ApiError("SCHEDULE_NOT_FOUND", "Salida no encontrada", 404);
  }

  const reservations = await prisma.reservation.count({ where: { scheduleId: id } });
  return prisma.$transaction(async (tx) => {
    if (reservations > 0) {
      const closed = await tx.schedule.update({ where: { id }, data: { status: "CLOSED" } });
      await recordScheduleAudit(tx, actor, `Salida cerrada porque ya tenía reservas${VIA_API}.`, schedule, closed);
      return { archived: true };
    }
    // La etiqueta se arma antes de borrar: después la salida ya no existe para nombrarla.
    await recordScheduleAudit(tx, actor, `Salida borrada${VIA_API}.`, schedule, null);
    await tx.schedule.delete({ where: { id } });
    return { deleted: true };
  });
}

export async function listAdminApiVehicles() {
  return prisma.vehicle.findMany({
    orderBy: { name: "asc" },
    include: vehicleInclude()
  });
}

export async function getAdminApiVehicle(id: string) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
    include: vehicleInclude()
  });

  if (!vehicle) {
    throw new ApiError("VEHICLE_NOT_FOUND", "Nave no encontrada", 404);
  }

  return vehicle;
}

export async function createAdminApiVehicle(payload: unknown, actor?: ApiActor | null) {
  const input = parseAdminPayload(adminVehicleInputSchema, payload);
  const vehicle = await prisma.$transaction(async (tx) => {
    const created = await tx.vehicle.create({
      data: {
        name: input.name,
        brand: input.brand,
        model: input.model,
        licensePlate: input.licensePlate,
        templateKey: input.templateKey,
        isActive: input.isActive,
        seats: {
          create: input.seats
        }
      }
    });
    const seats = listChange(null, input.seats.map((seat) => seat.number));
    await recordEntityAudit(tx, {
      actor, entity: "VEHICLE", entityId: created.id, entityLabel: created.name, summary: `Nave creada${VIA_API}.`, after: created,
      extra: seats ? { seats } : undefined
    });
    return created;
  });

  return getAdminApiVehicle(vehicle.id);
}

export async function patchAdminApiVehicle(id: string, payload: unknown, actor?: ApiActor | null) {
  const activeOnly = z.object({ isActive: z.coerce.boolean() }).safeParse(payload);

  if (activeOnly.success && Object.keys(payload as Record<string, unknown>).length === 1) {
    await prisma.$transaction(async (tx) => {
      const before = await tx.vehicle.findUnique({ where: { id }, select: { isActive: true } });
      const after = await tx.vehicle.update({ where: { id }, data: activeOnly.data });
      await recordEntityAudit(tx, {
        actor, entity: "VEHICLE", entityId: id, entityLabel: after.name,
        summary: `${after.isActive ? "Nave activada" : "Nave inactivada"}${VIA_API}.`, before, after: { isActive: after.isActive }
      });
    });
    return getAdminApiVehicle(id);
  }

  const input = parseAdminPayload(adminVehicleInputSchema, payload);

  await prisma.$transaction(async (tx) => {
    const before = await tx.vehicle.findUnique({ where: { id } });
    const updated = await tx.vehicle.update({
      where: { id },
      data: {
        name: input.name,
        brand: input.brand,
        model: input.model,
        licensePlate: input.licensePlate,
        templateKey: input.templateKey,
        isActive: input.isActive
      }
    });

    const currentSeats = await tx.seat.findMany({
      where: { vehicleId: id },
      include: {
        _count: {
          select: {
            reservations: true
          }
        }
      }
    });
    const currentByNumber = new Map(currentSeats.map((seat) => [seat.number, seat]));
    const nextNumbers = new Set(input.seats.map((seat) => seat.number));

    for (const currentSeat of currentSeats) {
      if (nextNumbers.has(currentSeat.number)) {
        continue;
      }

      if (currentSeat._count.reservations > 0) {
        throw new ApiError("SEAT_HAS_RESERVATIONS", `No se puede quitar el asiento ${currentSeat.number} porque ya tiene reservas.`, 409, {
          seats: `No se puede quitar el asiento ${currentSeat.number} porque ya tiene reservas.`
        });
      }

      await tx.seat.delete({ where: { id: currentSeat.id } });
    }

    for (const seat of input.seats) {
      const currentSeat = currentByNumber.get(seat.number);

      if (currentSeat) {
        await tx.seat.update({
          where: { id: currentSeat.id },
          data: {
            row: seat.row,
            column: seat.column
          }
        });
        continue;
      }

      await tx.seat.create({
        data: {
          vehicleId: id,
          ...seat
        }
      });
    }

    const seats = listChange(currentSeats.map((seat) => seat.number), input.seats.map((seat) => seat.number));
    await recordEntityAudit(tx, {
      actor, entity: "VEHICLE", entityId: id, entityLabel: updated.name, summary: `Nave editada${VIA_API}.`, before, after: updated,
      extra: seats ? { seats } : undefined
    });
  });

  return getAdminApiVehicle(id);
}

export async function deleteAdminApiVehicle(id: string, actor?: ApiActor | null) {
  return prisma.$transaction(async (tx) => {
    await lockFleet(tx, [id]);
    const vehicle = await tx.vehicle.findUnique({
      where: { id }, include: { _count: { select: { schedules: true, scheduleUnits: true, specialTripAssignments: true } } }
    });
    if (!vehicle) throw new ApiError("VEHICLE_NOT_FOUND", "Nave no encontrada", 404);
    if (vehicle._count.schedules || vehicle._count.scheduleUnits || vehicle._count.specialTripAssignments) {
      await tx.vehicle.update({ where: { id }, data: { isActive: false } });
      await recordEntityAudit(tx, {
        actor, entity: "VEHICLE", entityId: id, entityLabel: vehicle.name, action: "UPDATE",
        summary: `Nave archivada porque ya tenía viajes o salidas${VIA_API}.`, before: { isActive: vehicle.isActive }, after: { isActive: false }
      });
      return { archived: true };
    }
    await tx.vehicle.delete({ where: { id } });
    await recordEntityAudit(tx, { actor, entity: "VEHICLE", entityId: id, entityLabel: vehicle.name, summary: `Nave borrada${VIA_API}.`, before: vehicle });
    return { deleted: true };
  });
}

export async function listAdminApiReservations() {
  return listAdminReservations();
}

export async function getAdminApiReservation(code: string) {
  const reservation = await getReservationByCode(normalizeReservationCode(code));

  if (!reservation) {
    throw new ApiError("RESERVATION_NOT_FOUND", "Reserva no encontrada", 404);
  }

  return reservation;
}

export async function patchAdminApiReservation(code: string, payload: unknown, actor?: AuditActor | null) {
  const input = parseAdminPayload(adminReservationPassengerUpdateSchema, payload);
  return updatePassengerForReservation(normalizeReservationCode(code), input.passenger, actor);
}

export async function approveAdminApiReservationPayment(code: string, actor?: AuditActor | null) {
  return approveManualPayment(normalizeReservationCode(code), actor);
}
