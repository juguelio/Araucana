import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { normalizeShortCode } from "./codes";
import { DISABILITY_DOCUMENT_PROVIDER, DISABILITY_PENDING_STATUS } from "./disability-fare";

/**
 * Colas de cobro del panel: comprobantes subidos esperando validación (`receipt-pending`),
 * comprobantes que secretaría rechazó y hay que volver a pedir (`rejected`) y, desde el 19-nov,
 * todo pago pendiente de confirmar (`pending-payment`), tenga comprobante o no: la transferencia
 * que avisan por WhatsApp también es un pago esperando que alguien lo registre.
 */
export const ADMIN_PAYMENT_QUEUES = ["pending-payment", "paid-unconfirmed", "receipt-pending", "rejected", "documentation-pending"] as const;
export type AdminPaymentQueue = (typeof ADMIN_PAYMENT_QUEUES)[number];

/** Vistas por día de viaje del listado de reservas (pestañas Hoy, Próximas y Todas). */
export const ADMIN_RESERVATION_VIEWS = ["hoy", "proximas", "todas"] as const;
export type AdminReservationView = (typeof ADMIN_RESERVATION_VIEWS)[number];

/** Reservas por página en el panel: 25 filas entran sin scroll en un portátil. */
export const ADMIN_RESERVATIONS_PAGE_SIZE = 25;

/** Tamaños que ofrece el selector del listado. */
export const ADMIN_RESERVATIONS_PAGE_SIZES = [25, 50, 100] as const;

export const adminReservationFiltersSchema = z.object({
  // Búsqueda libre: sirve para encontrar una reserva sin saber en qué campo está el dato.
  // Apellido, DNI, código corto, email o teléfono del pasajero caen todos acá.
  q: z.string().trim().max(100).optional(),
  code: z.string().trim().max(100).optional(),
  route: z.string().trim().max(100).optional(),
  scheduleId: z.string().trim().max(100).optional(),
  date: z.union([z.literal(""), z.iso.date()]).optional(),
  // Hasta qué día buscar: sin esto, el filtro de fecha mostraba un solo día y para ver una
  // semana había que cambiar la URL a mano.
  until: z.union([z.literal(""), z.iso.date()]).optional(),
  // `?page=abc` o `?page=0` no pueden romper la búsqueda: caen en la primera página.
  page: z.coerce.number().int().min(1).catch(1).default(1),
  // Cuántas filas por página. Un valor raro no rompe nada: vuelve al tamaño por defecto.
  pageSize: z.coerce.number().int().catch(ADMIN_RESERVATIONS_PAGE_SIZE).default(ADMIN_RESERVATIONS_PAGE_SIZE),
  // Un valor que no es una cola conocida hace fallar el parse a propósito: la pantalla avisa
  // "Revisá los filtros" en vez de mostrar todas las reservas como si el filtro se hubiera aplicado.
  payment: z.union([z.literal(""), z.enum(ADMIN_PAYMENT_QUEUES)]).optional(),
  // Orden por columna (issue #192): viaja como texto y lo valida la lista blanca del listado
  // (`admin-reservation-sort.ts`). Un valor desconocido no rompe: cae al orden por defecto.
  orden: z.string().trim().max(30).optional(),
  dir: z.string().trim().max(8).optional(),
  // Vista por día de viaje (rediseño del 20-nov): «hoy» y «próximas» son los que viajan (sin las
  // canceladas); «todas» no filtra. Un valor desconocido cae a «todas» en vez de romper la página.
  vista: z.enum(ADMIN_RESERVATION_VIEWS).optional().catch(undefined)
});
export type AdminReservationFilters = z.input<typeof adminReservationFiltersSchema>;

/** Filas por página, con la misma normalización que el schema. */
export function adminReservationsPageSize(input: AdminReservationFilters): number {
  const { pageSize } = adminReservationFiltersSchema.parse(input);
  return ADMIN_RESERVATIONS_PAGE_SIZES.includes(pageSize as (typeof ADMIN_RESERVATIONS_PAGE_SIZES)[number])
    ? pageSize
    : ADMIN_RESERVATIONS_PAGE_SIZE;
}

/** Página pedida, normalizada con la misma regla que el schema (1 si viene rota o vacía). */
export function adminReservationsPage(input: AdminReservationFilters): number {
  return adminReservationFiltersSchema.parse(input).page;
}

// The date is the travel day, not the date on which the reservation was created.
export function adminReservationWhere(input: AdminReservationFilters, passengerIds: string[] = [], ahora = new Date()): Prisma.ReservationWhereInput {
  const filters = adminReservationFiltersSchema.parse(input);
  const AND: Prisma.ReservationWhereInput[] = [];
  if (filters.vista === "hoy" || filters.vista === "proximas") {
    // Los que viajan: hoy, o de hoy en adelante. Las canceladas no viajan (siguen en «Todas»).
    const hoy = argentinaDateKey(ahora);
    const gte = new Date(`${hoy}T00:00:00-03:00`);
    const calendarFrom = new Date(`${hoy}T00:00:00Z`);
    const lt = filters.vista === "hoy" ? new Date(gte.getTime() + 86400000) : undefined;
    const calendarTo = filters.vista === "hoy" ? new Date(calendarFrom.getTime() + 86400000) : undefined;
    AND.push({ status: { not: "CANCELLED" } });
    AND.push({ OR: [
      { schedule: { is: { departureAt: { gte, ...(lt ? { lt } : {}) } } } },
      { airportDetails: { is: { serviceDate: { gte, ...(lt ? { lt } : {}) } } } },
      { chapelcoDetails: { is: { serviceDate: { gte: calendarFrom, ...(calendarTo ? { lt: calendarTo } : {}) } } } }
    ] });
  }
  if (filters.code) {
    // El mismo campo busca las dos formas del código: el largo del link privado y el corto que
    // se dicta por teléfono (con o sin guiones: "abcd-2345" es "ABCD2345", y también se puede
    // buscar por un pedazo del corto).
    const shortCode = normalizeShortCode(filters.code);
    const matches: Prisma.ReservationWhereInput[] = [{ code: { contains: filters.code, mode: "insensitive" } }];
    if (shortCode) matches.push({ shortCode: { contains: shortCode, mode: "insensitive" } });
    AND.push({ OR: matches });
  }
  if (filters.q) {
    // Una sola caja para todo: el que atiende el teléfono escribe "Perez", "30.123.456" o
    // "ABCD-2345" sin tener que decidir en qué filtro va.
    const term = filters.q;
    const texto = { contains: term, mode: "insensitive" as const };
    const matches: Prisma.ReservationWhereInput[] = [
      { code: texto },
      { passenger: { is: { OR: [
        { firstName: texto },
        { lastName: texto },
        { documentId: texto },
        { email: texto },
        { phone: texto }
      ] } } },
      { route: { is: { OR: [{ from: texto }, { to: texto }, { slug: texto }] } } }
    ];
    const shortCode = normalizeShortCode(term);
    if (shortCode) matches.push({ shortCode: { contains: shortCode, mode: "insensitive" } });
    // Los apellidos llevan tilde ("Pérez") y el que atiende escribe sin ella. ILIKE no la ignora,
    // así que la búsqueda por pasajero llega ya resuelta desde el repositorio (ids sin acentos).
    if (passengerIds.length) matches.push({ passengerId: { in: passengerIds } });
    AND.push({ OR: matches });
  }
  if (filters.scheduleId) AND.push({ scheduleId: filters.scheduleId });
  if (filters.route) {
    const route: Prisma.TravelRouteWhereInput = { OR: ["from", "to", "slug"].map((field) => ({
      [field]: { contains: filters.route, mode: "insensitive" }
    })) };
    AND.push({ OR: [{ route: { is: route } }, { schedule: { is: { route: { is: route } } } }] });
  }
  if (filters.payment === "pending-payment") {
    // El pago que todavía no está confirmado: con comprobante (esperando validación) o sin él
    // (plata cobrada que secretaría tiene que registrar). Sólo reservas de pago manual.
    AND.push({ status: "PENDING_PAYMENT" });
    AND.push({ payment: { is: { status: "PENDING", provider: "MANUAL" } } });
  }
  if (filters.payment === "paid-unconfirmed") {
    AND.push({ status: "PENDING_PAYMENT" });
    AND.push({ payment: { is: { status: "APPROVED", provider: { not: DISABILITY_DOCUMENT_PROVIDER } } } });
  }
  if (filters.payment === "receipt-pending") {
    // La cola de trabajo real de secretaría: comprobante subido y pago todavía sin resolver.
    AND.push({ status: "PENDING_PAYMENT" });
    AND.push({ payment: { is: { status: "PENDING", receiptBlobPathname: { not: null } } } });
  }
  if (filters.payment === "documentation-pending") {
    AND.push({ status: DISABILITY_PENDING_STATUS });
    AND.push({ payment: { is: { provider: DISABILITY_DOCUMENT_PROVIDER, status: "PENDING", receiptBlobPathname: { not: null } } } });
  }
  if (filters.payment === "rejected") {
    AND.push({ payment: { is: { status: "REJECTED" } } });
  }
  if (filters.date || filters.until) {
    // El rango va del día "desde" al día "hasta" inclusive. Con un solo campo se busca ese día.
    const desde = filters.date || filters.until!;
    const hasta = filters.until && filters.until >= desde ? filters.until : desde;
    const gte = new Date(`${desde}T00:00:00-03:00`);
    const lt = new Date(new Date(`${hasta}T00:00:00-03:00`).getTime() + 86400000);
    // Chapelco guarda la fecha como día calendario a medianoche UTC; AIRPORT, a medianoche argentina.
    const calendarFrom = new Date(`${desde}T00:00:00Z`);
    const calendarTo = new Date(new Date(`${hasta}T00:00:00Z`).getTime() + 86400000);
    AND.push({ OR: [
      { schedule: { is: { departureAt: { gte, lt } } } },
      { airportDetails: { is: { serviceDate: { gte, lt } } } },
      { chapelcoDetails: { is: { serviceDate: { gte: calendarFrom, lt: calendarTo } } } }
    ] });
  }
  return AND.length ? { AND } : {};
}

/** Texto sin tildes ni mayúsculas, para comparar "Perez" con "Pérez". */
export function normalizarBusqueda(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
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

// Chapelco guarda la fecha del servicio como día calendario a medianoche UTC; el resto son instantes.
// Se normaliza a 'YYYY-MM-DD' antes de mostrarlo para no correrlo un día.
export function travelDayKey(calendar: Date | null | undefined, instant: Date | null | undefined): string | null {
  if (calendar) return calendar.toISOString().slice(0, 10);
  return instant ? argentinaDateKey(instant) : null;
}

const travelMonthFormatter = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", month: "short" });

// Se arma a mano: según el ICU, `es-AR` con día/mes/año mete "de" entre las partes.
export function formatTravelDay(day: string | null): string {
  if (!day) return "-";
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "-";
  const month = travelMonthFormatter.format(date).replace(".", "");
  return `${String(date.getUTCDate()).padStart(2, "0")} ${month} ${date.getUTCFullYear()}`;
}

export function argentinaDayStart(date: string): Date {
  return new Date(`${date}T00:00:00-03:00`);
}

// Salidas que el alta manual ofrece: abiertas o en documentación, desde el inicio del día
// argentino de hoy. Sin esto la pantalla trae meses de historial con todas sus reservas.
export const BOOKABLE_SCHEDULE_STATUSES = ["OPEN", "DOCUMENTATION"] as const;

export const adminScheduleFiltersSchema = z.object({
  routeId: z.string().trim().min(1).max(64).optional(),
  from: z.string().trim().max(120).optional(),
  to: z.string().trim().max(120).optional(),
  date: z.union([z.literal(""), z.iso.date()]).optional(),
  bookableOnly: z.boolean().optional(),
  // El alta manual no ofrece el aeropuerto: ese servicio se reserva eligiendo el vuelo (issue #79).
  excludeAirport: z.boolean().optional()
});
export type AdminScheduleFilters = z.infer<typeof adminScheduleFiltersSchema>;

export function adminScheduleWhere(input: AdminScheduleFilters = {}, now = new Date()): Prisma.ScheduleWhereInput {
  const filters = adminScheduleFiltersSchema.parse(input);
  const AND: Prisma.ScheduleWhereInput[] = [];
  if (filters.routeId) AND.push({ routeId: filters.routeId });
  // Nombre de parada exacto, sin distinguir mayúsculas: "sma" y "SMA" tienen que caer en la misma ruta.
  if (filters.from) AND.push({ route: { is: { from: { equals: filters.from, mode: "insensitive" } } } });
  if (filters.to) AND.push({ route: { is: { to: { equals: filters.to, mode: "insensitive" } } } });
  if (filters.date) {
    const gte = argentinaDayStart(filters.date);
    AND.push({ departureAt: { gte, lt: new Date(gte.getTime() + 86400000) } });
  }
  if (filters.excludeAirport) {
    // Sin esta exclusión el tramo San Martín ↔ Aeropuerto Chapelco se ofrecía con sus salidas
    // horarias (09:00, 13:00, 17:00, 21:00) y la reserva quedaba sin número de vuelo: sin horario
    // de vuelo no se puede calcular la recorrida ni saber qué combi lleva a cada pasajero.
    AND.push({ route: { is: { bookingMode: { not: "AIRPORT" } } } });
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
