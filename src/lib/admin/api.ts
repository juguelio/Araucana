import { lockFleet, savePublicSchedule } from "@/lib/special-trips/conflicts";
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

export async function createAdminApiRoute(payload: unknown) {
  const data = parseAdminPayload(adminRouteInputSchema, payload);
  const route = await prisma.travelRoute.create({ data });
  return getAdminApiRoute(route.id);
}

export async function updateAdminApiRoute(id: string, payload: unknown) {
  const data = parseAdminPayload(adminRouteInputSchema, payload);
  await prisma.travelRoute.update({ where: { id }, data });
  return getAdminApiRoute(id);
}

export async function patchAdminApiRoute(id: string, payload: unknown) {
  const activeOnly = z.object({ isActive: z.coerce.boolean() }).safeParse(payload);

  if (activeOnly.success && Object.keys(payload as Record<string, unknown>).length === 1) {
    await prisma.travelRoute.update({ where: { id }, data: { isActive: activeOnly.data.isActive } });
    return getAdminApiRoute(id);
  }

  return updateAdminApiRoute(id, payload);
}

export async function deleteAdminApiRoute(id: string) {
  const route = await prisma.travelRoute.findUnique({ where: { id }, select: { id: true } });
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
    await prisma.$transaction([
      prisma.travelRoute.update({ where: { id }, data: { isActive: false } }),
      prisma.schedule.updateMany({ where: { routeId: id }, data: { status: "CLOSED" } })
    ]);
    return { archived: true };
  }

  await prisma.travelRoute.delete({ where: { id } });
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
  userId: string,
  confirmation?: string,
  id?: string,
  statusOnly = false
) {
  const result = await prisma.$transaction((tx) => savePublicSchedule(tx, data, userId, confirmation ?? "", id, statusOnly));
  if (result.conflicts) {
    throw new ApiError("FLEET_CONFLICT", "La nave ya tiene un viaje especial en ese horario.", 409, {
      confirmation: result.confirmation, conflicts: JSON.stringify(result.conflicts)
    });
  }
  return getAdminApiSchedule(result.id);
}

async function saveAdminApiSchedule(payload: unknown, userId: string, id?: string) {
  const { confirmation, ...input } = parseAdminPayload(adminScheduleInputSchema, payload);
  const durationMin = await getRouteDuration(input.routeId);
  return persistAdminApiSchedule({ ...input, arrivalAt: addMinutes(input.departureAt, durationMin) }, userId, confirmation, id);
}

export async function createAdminApiSchedule(payload: unknown, userId: string) {
  return saveAdminApiSchedule(payload, userId);
}

export async function patchAdminApiSchedule(id: string, payload: unknown, userId: string) {
  if (payload && typeof payload === "object" && Object.keys(payload).every((key) => ["status", "confirmation"].includes(key))) {
    const { status, confirmation } = parseAdminPayload(adminScheduleStatusSchema, payload);
    const current = await getAdminApiSchedule(id);
    const { routeId, vehicleId, departureAt, arrivalAt } = current;
    return persistAdminApiSchedule({ routeId, vehicleId, departureAt, arrivalAt, status }, userId, confirmation, id, true);
  }
  return saveAdminApiSchedule(payload, userId, id);
}

export async function deleteAdminApiSchedule(id: string) {
  const schedule = await prisma.schedule.findUnique({ where: { id }, select: { id: true } });
  if (!schedule) {
    throw new ApiError("SCHEDULE_NOT_FOUND", "Salida no encontrada", 404);
  }

  const reservations = await prisma.reservation.count({ where: { scheduleId: id } });
  if (reservations > 0) {
    await prisma.schedule.update({ where: { id }, data: { status: "CLOSED" } });
    return { archived: true };
  }

  await prisma.schedule.delete({ where: { id } });
  return { deleted: true };
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

export async function createAdminApiVehicle(payload: unknown) {
  const input = parseAdminPayload(adminVehicleInputSchema, payload);
  const vehicle = await prisma.vehicle.create({
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

  return getAdminApiVehicle(vehicle.id);
}

export async function patchAdminApiVehicle(id: string, payload: unknown) {
  const activeOnly = z.object({ isActive: z.coerce.boolean() }).safeParse(payload);

  if (activeOnly.success && Object.keys(payload as Record<string, unknown>).length === 1) {
    await prisma.vehicle.update({ where: { id }, data: activeOnly.data });
    return getAdminApiVehicle(id);
  }

  const input = parseAdminPayload(adminVehicleInputSchema, payload);

  await prisma.$transaction(async (tx) => {
    await tx.vehicle.update({
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
  });

  return getAdminApiVehicle(id);
}

export async function deleteAdminApiVehicle(id: string) {
  return prisma.$transaction(async (tx) => {
    await lockFleet(tx, [id]);
    const vehicle = await tx.vehicle.findUnique({
      where: { id }, select: { _count: { select: { schedules: true, specialTripAssignments: true } } }
    });
    if (!vehicle) throw new ApiError("VEHICLE_NOT_FOUND", "Nave no encontrada", 404);
    if (vehicle._count.schedules || vehicle._count.specialTripAssignments) {
      await tx.vehicle.update({ where: { id }, data: { isActive: false } });
      return { archived: true };
    }
    await tx.vehicle.delete({ where: { id } });
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

export async function patchAdminApiReservation(code: string, payload: unknown) {
  const input = parseAdminPayload(adminReservationPassengerUpdateSchema, payload);
  return updatePassengerForReservation(normalizeReservationCode(code), input.passenger);
}

export async function approveAdminApiReservationPayment(code: string) {
  return approveManualPayment(normalizeReservationCode(code));
}
