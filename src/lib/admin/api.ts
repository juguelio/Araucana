import { z, type ZodError } from "zod";
import { ApiError, type ApiErrorFields } from "@/lib/api/responses";
import { assertVehicleDocumented } from "@/lib/compliance/documents";
import { approveManualPayment, getReservationByCode, listAdminReservations, listAdminRoutes, listAdminSchedules, updatePassengerForReservation } from "@/lib/booking/repository";
import { passengerSchema } from "@/lib/booking/validation";
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
  note: z.string().trim().default("")
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
  .transform((input) => ({
    ...input,
    slug: input.slug?.trim() || slugify(`${input.from}-${input.to}-${input.via}`)
  }));

export const adminScheduleInputSchema = z.object({
  routeId: requiredString,
  vehicleId: requiredString,
  departureAt: isoDateSchema("departureAt"),
  status: z.enum(scheduleStatuses).default("OPEN")
});

export const adminScheduleStatusSchema = z.object({
  status: z.enum(scheduleStatuses)
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
  passenger: passengerSchema
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

export async function createAdminApiSchedule(payload: unknown) {
  const input = parseAdminPayload(adminScheduleInputSchema, payload);
  // Una nave con documentación crítica vencida no sale (aunque el panel lo permita, el server no).
  await assertVehicleDocumented(input.vehicleId);
  const durationMin = await getRouteDuration(input.routeId);
  const schedule = await prisma.schedule.create({
    data: {
      ...input,
      arrivalAt: addMinutes(input.departureAt, durationMin)
    }
  });

  return getAdminApiSchedule(schedule.id);
}

export async function patchAdminApiSchedule(id: string, payload: unknown) {
  const statusOnly = adminScheduleStatusSchema.safeParse(payload);

  if (statusOnly.success && Object.keys(payload as Record<string, unknown>).length === 1) {
    await prisma.schedule.update({ where: { id }, data: statusOnly.data });
    return getAdminApiSchedule(id);
  }

  const input = parseAdminPayload(adminScheduleInputSchema, payload);
  const durationMin = await getRouteDuration(input.routeId);
  await prisma.schedule.update({
    where: { id },
    data: {
      ...input,
      arrivalAt: addMinutes(input.departureAt, durationMin)
    }
  });
  return getAdminApiSchedule(id);
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
  const vehicle = await prisma.vehicle.findUnique({ where: { id }, select: { id: true } });
  if (!vehicle) {
    throw new ApiError("VEHICLE_NOT_FOUND", "Nave no encontrada", 404);
  }

  const scheduleCount = await prisma.schedule.count({ where: { vehicleId: id } });
  if (scheduleCount > 0) {
    await prisma.vehicle.update({ where: { id }, data: { isActive: false } });
    return { archived: true };
  }

  await prisma.vehicle.delete({ where: { id } });
  return { deleted: true };
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
