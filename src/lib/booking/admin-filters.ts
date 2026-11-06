import type { Prisma } from "@prisma/client";
import { z } from "zod";

/**
 * Colas de cobro del panel: comprobantes subidos esperando validación (`receipt-pending`) y
 * comprobantes que secretaría rechazó y hay que volver a pedir (`rejected`).
 */
export const ADMIN_PAYMENT_QUEUES = ["receipt-pending", "rejected"] as const;
export type AdminPaymentQueue = (typeof ADMIN_PAYMENT_QUEUES)[number];

export const adminReservationFiltersSchema = z.object({
  code: z.string().trim().max(100).optional(),
  route: z.string().trim().max(100).optional(),
  scheduleId: z.string().trim().max(100).optional(),
  date: z.union([z.literal(""), z.iso.date()]).optional(),
  // `?page=abc` o `?page=0` no pueden romper la búsqueda: caen en la primera página.
  page: z.coerce.number().int().min(1).catch(1).default(1),
  // Un valor que no es una cola conocida hace fallar el parse a propósito: la pantalla avisa
  // "Revisá los filtros" en vez de mostrar todas las reservas como si el filtro se hubiera aplicado.
  payment: z.enum(ADMIN_PAYMENT_QUEUES).optional()
});
export type AdminReservationFilters = z.input<typeof adminReservationFiltersSchema>;

/** Página pedida, normalizada con la misma regla que el schema (1 si viene rota o vacía). */
export function adminReservationsPage(input: AdminReservationFilters): number {
  return adminReservationFiltersSchema.parse(input).page;
}

/** Reservas por página en el panel: 25 filas entran sin scroll en un portátil. */
export const ADMIN_RESERVATIONS_PAGE_SIZE = 25;

// The date is the travel day, not the date on which the reservation was created.
export function adminReservationWhere(input: AdminReservationFilters): Prisma.ReservationWhereInput {
  const filters = adminReservationFiltersSchema.parse(input);
  const AND: Prisma.ReservationWhereInput[] = [];
  if (filters.code) AND.push({ code: { contains: filters.code, mode: "insensitive" } });
  if (filters.scheduleId) AND.push({ scheduleId: filters.scheduleId });
  if (filters.route) {
    const route: Prisma.TravelRouteWhereInput = { OR: ["from", "to", "slug"].map((field) => ({
      [field]: { contains: filters.route, mode: "insensitive" }
    })) };
    AND.push({ OR: [{ route: { is: route } }, { schedule: { is: { route: { is: route } } } }] });
  }
  if (filters.payment === "receipt-pending") {
    // La cola de trabajo real de secretaría: comprobante subido y pago todavía sin resolver.
    AND.push({ status: "PENDING_PAYMENT" });
    AND.push({ payment: { is: { status: "PENDING", receiptBlobPathname: { not: null } } } });
  }
  if (filters.payment === "rejected") {
    AND.push({ payment: { is: { status: "REJECTED" } } });
  }
  if (filters.date) {
    const gte = new Date(`${filters.date}T00:00:00-03:00`);
    const lt = new Date(gte.getTime() + 86400000);
    // Chapelco stores a calendar date at UTC midnight; AIRPORT stores Argentine midnight.
    AND.push({ OR: [
      { schedule: { is: { departureAt: { gte, lt } } } },
      { airportDetails: { is: { serviceDate: { gte, lt } } } },
      { chapelcoDetails: { is: { serviceDate: new Date(`${filters.date}T00:00:00Z`) } } }
    ] });
  }
  return AND.length ? { AND } : {};
}

// Argentina no tiene horario de verano: el día del viaje arranca siempre a las 00:00 -03:00.
export function argentinaDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Salta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function argentinaDayStart(date: string): Date {
  return new Date(`${date}T00:00:00-03:00`);
}

// Salidas que el alta manual ofrece: abiertas o en documentación, desde el inicio del día
// argentino de hoy. Sin esto la pantalla trae meses de historial con todas sus reservas.
export const BOOKABLE_SCHEDULE_STATUSES = ["OPEN", "DOCUMENTATION"] as const;

export const adminScheduleFiltersSchema = z.object({
  from: z.string().trim().max(120).optional(),
  to: z.string().trim().max(120).optional(),
  date: z.union([z.literal(""), z.iso.date()]).optional(),
  bookableOnly: z.boolean().optional()
});
export type AdminScheduleFilters = z.infer<typeof adminScheduleFiltersSchema>;

export function adminScheduleWhere(input: AdminScheduleFilters = {}, now = new Date()): Prisma.ScheduleWhereInput {
  const filters = adminScheduleFiltersSchema.parse(input);
  const AND: Prisma.ScheduleWhereInput[] = [];
  // Nombre de parada exacto, sin distinguir mayúsculas: "sma" y "SMA" tienen que caer en la misma ruta.
  if (filters.from) AND.push({ route: { is: { from: { equals: filters.from, mode: "insensitive" } } } });
  if (filters.to) AND.push({ route: { is: { to: { equals: filters.to, mode: "insensitive" } } } });
  if (filters.date) {
    const gte = argentinaDayStart(filters.date);
    AND.push({ departureAt: { gte, lt: new Date(gte.getTime() + 86400000) } });
  }
  if (filters.bookableOnly) {
    AND.push({ status: { in: [...BOOKABLE_SCHEDULE_STATUSES] } });
    // Se ofrece exactamente lo que el alta va a aceptar (repository.ts): una salida que ya arrancó
    // hoy, o de una ruta/nave dada de baja, sólo servía para completar el formulario y comer un rechazo.
    AND.push({ departureAt: { gte: now } });
    AND.push({ route: { is: { isActive: true } } });
    AND.push({ vehicle: { is: { isActive: true } } });
  }
  return AND.length ? { AND } : {};
}
