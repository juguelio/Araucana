import { prisma } from "@/lib/db/prisma";
import { createReservationCode as defaultCreateReservationCode, createTicketCode } from "./codes";
import {
  AdminRouteRowDto,
  AdminReservationRowDto,
  AdminScheduleRowDto,
  PublicRouteDto,
  ReservationDetailDto,
  ScheduleOptionDto,
  SeatMapDto
} from "./types";
import { createReservationSchema, passengerSchema, type CreateReservationInput, type PassengerInput } from "./validation";
import { manualPaymentProvider } from "@/lib/payments/manual-provider";
import type { PaymentProvider } from "@/lib/payments/types";

type RouteRecord = {
  id: string;
  slug: string;
  from: string;
  to: string;
  via: string;
  description: string;
  category: string;
  featured: boolean;
  isActive: boolean;
  durationMin: number;
  priceCents: number;
  currency: string;
  bookingMode: string;
  specialType?: string | null;
  serviceStartDate?: Date | null;
  serviceEndDate?: Date | null;
  stops?: unknown;
  _count?: {
    schedules: number;
  };
};

type SeatRecord = {
  id: string;
  vehicleId: string;
  number: string;
  row: number;
  column: number;
};

type ScheduleRecord = {
  id: string;
  routeId: string;
  vehicleId: string;
  departureAt: Date;
  arrivalAt: Date;
  status: string;
  route: RouteRecord;
  vehicle: {
    id: string;
    isActive?: boolean;
    seats: SeatRecord[];
  };
  reservations?: Array<{
    id: string;
    seatId: string;
    seatNumber: string;
    passengerCount: number;
    status: string;
  }>;
};

type PassengerRecord = {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  documentType: string;
  documentId: string;
  nationality?: string | null;
};

type PaymentRecord = {
  provider: string;
  status: string;
  amountCents: number;
  currency: string;
  externalRef?: string | null;
  receiptBlobUrl?: string | null;
  receiptBlobPathname?: string | null;
  receiptFileName?: string | null;
  receiptContentType?: string | null;
  receiptSize?: number | null;
  receiptUploadedAt?: Date | null;
};

type TicketRecord = {
  code: string;
  qrPayload: string;
};

type ReservationRecord = {
  id: string;
  code: string;
  scheduleId: string | null;
  routeId?: string | null;
  passengerId: string;
  seatId: string | null;
  seatNumber: string | null;
  passengerCount: number;
  bookingMode: string;
  status: string;
  totalCents: number;
  currency: string;
  createdAt: Date;
  schedule?: ScheduleRecord | null;
  route?: RouteRecord | null;
  passenger: PassengerRecord;
  payment?: PaymentRecord | null;
  ticket?: TicketRecord | null;
  chapelcoDetails?: {
    serviceDate: Date;
    ascentSlot: string;
    pickupName: string;
    pickupAddress: string;
    pickupLatitude: number;
    pickupLongitude: number;
    pickupNotes?: string | null;
  } | null;
  airportDetails?: {
    flightNumber: string;
    direction: string;
    serviceDate: Date;
    pickupName?: string | null;
    pickupAddress?: string | null;
    pickupNotes?: string | null;
    flight?: { scheduledAt: Date; estimatedAt: Date | null; status: string } | null;
  } | null;
};

type BookingTransactionClient = {
  travelRoute: {
    findMany(args?: unknown): Promise<RouteRecord[]>;
    findUnique(args: unknown): Promise<RouteRecord | null>;
    findFirst(args: unknown): Promise<RouteRecord | null>;
  };
  schedule: {
    findMany(args?: unknown): Promise<ScheduleRecord[]>;
    findUnique(args: unknown): Promise<ScheduleRecord | null>;
  };
  seat: {
    findFirst(args: unknown): Promise<SeatRecord | null>;
  };
  passenger: {
    create(args: unknown): Promise<PassengerRecord & { id: string }>;
    update(args: unknown): Promise<PassengerRecord>;
  };
  reservation: {
    findFirst(args: unknown): Promise<ReservationRecord | null>;
    findMany(args?: unknown): Promise<ReservationRecord[]>;
    findUnique(args: unknown): Promise<ReservationRecord | null>;
    create(args: unknown): Promise<ReservationRecord>;
    update(args: unknown): Promise<ReservationRecord>;
  };
  payment: {
    create(args: unknown): Promise<PaymentRecord>;
    update(args: unknown): Promise<PaymentRecord>;
  };
  ticket: {
    create(args: unknown): Promise<TicketRecord>;
  };
};

export type BookingClient = BookingTransactionClient & {
  $transaction<T>(callback: (client: BookingTransactionClient) => Promise<T>, options?: { isolationLevel: "Serializable" }): Promise<T>;
};

type BookingRepositoryDeps = {
  createReservationCode?: () => string;
  paymentProvider?: PaymentProvider;
};

const MAX_RESERVATION_CODE_ATTEMPTS = 3;

export class BookingError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "BookingError";
  }
}

function centsToPrice(cents: number) {
  return cents / 100;
}

function dateKey(date?: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

function isUniqueConstraintError(error: unknown): error is { code: string; meta?: { target?: unknown } } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function uniqueConstraintTargets(error: { meta?: { target?: unknown } }) {
  const target = error.meta?.target;

  if (Array.isArray(target)) {
    return target.filter((item): item is string => typeof item === "string");
  }

  if (typeof target === "string") {
    return [target];
  }

  return [];
}

function uniqueConstraintHasFields(targets: string[], fields: string[]) {
  return fields.every((field) => targets.some((target) => target === field || target.includes(field)));
}

function isSeatUniqueConstraintError(error: unknown) {
  if (!isUniqueConstraintError(error)) {
    return false;
  }

  const targets = uniqueConstraintTargets(error);
  return (
    uniqueConstraintHasFields(targets, ["scheduleId", "seatNumber"]) ||
    uniqueConstraintHasFields(targets, ["scheduleId", "seatId"])
  );
}

function isReservationCodeUniqueConstraintError(error: unknown) {
  if (!isUniqueConstraintError(error)) {
    return false;
  }

  return uniqueConstraintHasFields(uniqueConstraintTargets(error), ["code"]);
}

function mapRoute(route: RouteRecord): PublicRouteDto {
  return {
    id: route.id,
    slug: route.slug,
    from: route.from,
    to: route.to,
    via: route.via,
    description: route.description,
    category: route.category,
    featured: route.featured,
    durationMin: route.durationMin,
    priceCents: route.priceCents,
    price: centsToPrice(route.priceCents),
    currency: route.currency,
    bookingMode: route.bookingMode,
    specialType: route.specialType,
    serviceStartDate: dateKey(route.serviceStartDate),
    serviceEndDate: dateKey(route.serviceEndDate),
    stops: route.stops
  };
}

function mapSchedule(schedule: ScheduleRecord): ScheduleOptionDto {
  const totalSeats = schedule.vehicle.seats.length;
  const occupiedSeats = (schedule.reservations ?? [])
    .filter((reservation) => reservation.status !== "CANCELLED")
    .reduce((total, reservation) => total + reservation.passengerCount, 0);

  return {
    id: schedule.id,
    route: mapRoute(schedule.route),
    departureAt: schedule.departureAt,
    arrivalAt: schedule.arrivalAt,
    status: schedule.status,
    availableSeats: Math.max(totalSeats - occupiedSeats, 0),
    totalSeats,
    priceCents: schedule.route.priceCents,
    price: centsToPrice(schedule.route.priceCents),
    currency: schedule.route.currency
  };
}

function mapReservation(reservation: ReservationRecord): ReservationDetailDto {
  const routeRecord = reservation.schedule?.route ?? reservation.route;

  if (!routeRecord) {
    throw new BookingError("ROUTE_NOT_FOUND", "Reservation route not found");
  }

  const route = mapRoute(routeRecord);
  const departureAt =
    reservation.schedule?.departureAt ??
    reservation.airportDetails?.flight?.estimatedAt ??
    reservation.airportDetails?.flight?.scheduledAt ??
    reservation.chapelcoDetails?.serviceDate ??
    reservation.createdAt;
  const arrivalAt = reservation.schedule?.arrivalAt ?? departureAt;

  return {
    id: reservation.id,
    code: reservation.code,
    bookingMode: reservation.bookingMode,
    passengerCount: reservation.passengerCount,
    status: reservation.status,
    seatNumber: reservation.seatNumber,
    totalCents: reservation.totalCents,
    total: centsToPrice(reservation.totalCents),
    currency: reservation.currency,
    createdAt: reservation.createdAt,
    route,
    schedule: {
      id: reservation.schedule?.id ?? "",
      route,
      departureAt,
      arrivalAt,
      status: reservation.schedule?.status ?? reservation.status,
      priceCents: routeRecord.priceCents,
      price: centsToPrice(routeRecord.priceCents),
      currency: routeRecord.currency
    },
    passenger: {
      firstName: reservation.passenger.firstName,
      lastName: reservation.passenger.lastName,
      email: reservation.passenger.email,
      phone: reservation.passenger.phone,
      documentType: reservation.passenger.documentType,
      documentId: reservation.passenger.documentId,
      nationality: reservation.passenger.nationality
    },
    payment: reservation.payment
      ? {
          provider: reservation.payment.provider,
          status: reservation.payment.status,
          amountCents: reservation.payment.amountCents,
          amount: centsToPrice(reservation.payment.amountCents),
          currency: reservation.payment.currency,
          externalRef: reservation.payment.externalRef,
          receiptBlobUrl: reservation.payment.receiptBlobUrl,
          receiptBlobPathname: reservation.payment.receiptBlobPathname,
          receiptFileName: reservation.payment.receiptFileName,
          receiptContentType: reservation.payment.receiptContentType,
          receiptSize: reservation.payment.receiptSize,
          receiptUploadedAt: reservation.payment.receiptUploadedAt
        }
      : null,
    ticket: reservation.ticket
      ? {
          code: reservation.ticket.code,
          qrPayload: reservation.ticket.qrPayload
        }
      : null,
    chapelcoDetails: reservation.chapelcoDetails
      ? {
          serviceDate: reservation.chapelcoDetails.serviceDate,
          ascentSlot: reservation.chapelcoDetails.ascentSlot,
          pickupName: reservation.chapelcoDetails.pickupName,
          pickupAddress: reservation.chapelcoDetails.pickupAddress,
          pickupLatitude: reservation.chapelcoDetails.pickupLatitude,
          pickupLongitude: reservation.chapelcoDetails.pickupLongitude,
          pickupNotes: reservation.chapelcoDetails.pickupNotes
        }
      : null,
    airportDetails: reservation.airportDetails
      ? {
          flightNumber: reservation.airportDetails.flightNumber,
          direction: reservation.airportDetails.direction,
          serviceDate: reservation.airportDetails.serviceDate,
          pickupName: reservation.airportDetails.pickupName,
          pickupAddress: reservation.airportDetails.pickupAddress,
          pickupNotes: reservation.airportDetails.pickupNotes,
          flight: reservation.airportDetails.flight
            ? {
                scheduledAt: reservation.airportDetails.flight.scheduledAt,
                estimatedAt: reservation.airportDetails.flight.estimatedAt,
                status: reservation.airportDetails.flight.status
              }
            : null
        }
      : null
  };
}

function normalizePassengerInput(input: PassengerInput): PassengerInput {
  const nationality = input.nationality?.trim() || null;

  return {
    ...input,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    documentType: input.documentType.trim(),
    documentId: input.documentId.trim(),
    nationality
  };
}

function reservationInclude() {
  return {
    schedule: {
      include: {
        route: true,
        vehicle: {
          include: {
            seats: true
          }
        }
      }
    },
    route: true,
    passenger: true,
    payment: true,
    ticket: true,
    chapelcoDetails: true,
    airportDetails: { include: { flight: true } }
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

function compareSeats(left: SeatRecord, right: SeatRecord) {
  return left.row - right.row || left.column - right.column || left.number.localeCompare(right.number);
}

function orderedSeats(seats: SeatRecord[]) {
  return [...seats].sort(compareSeats);
}

/**
 * Control interno de cupo: la reserva web no elige asiento y el pasajero nunca ve un número.
 * El negocio carga la nave por orden de llegada y decide qué vehículo manda, así que el lugar
 * asignado sólo sirve para no sobrevender ni duplicar el mismo lugar en la misma salida.
 * Devuelve el primer lugar libre en el mismo orden en que se muestra el mapa de asientos.
 */
function firstAvailableSeat(
  seats: SeatRecord[],
  occupiedSeatIds: Set<string | null>,
  occupiedSeatNumbers: Set<string | null>
) {
  return (
    orderedSeats(seats).find((seat) => !occupiedSeatIds.has(seat.id) && !occupiedSeatNumbers.has(seat.number)) ?? null
  );
}

async function getReservationByCodeWithClient(client: BookingTransactionClient, code: string) {
  const reservation = await client.reservation.findUnique({
    where: { code },
    include: reservationInclude()
  });

  return reservation ? mapReservation(reservation) : null;
}

export function createBookingRepository(client: BookingClient, deps: BookingRepositoryDeps = {}) {
  const createCode = deps.createReservationCode ?? (() => defaultCreateReservationCode());
  const paymentProvider = deps.paymentProvider ?? manualPaymentProvider;

  return {
    async listPublicRoutes() {
      const routes = await client.travelRoute.findMany({
        // CHAPELCO y AIRPORT tienen su propio flujo (el aeropuerto se reserva por vuelo, no por horario).
        where: { isActive: true, bookingMode: { notIn: ["CHAPELCO", "AIRPORT"] } },
        orderBy: [{ featured: "desc" }, { from: "asc" }, { to: "asc" }, { slug: "asc" }]
      });

      return routes.map(mapRoute);
    },

    async getPublicRouteBySlug(slug: string) {
      const route = await client.travelRoute.findFirst({
        where: { slug, isActive: true }
      });

      return route ? mapRoute(route) : null;
    },

    async listSchedulesForRoute(routeId: string) {
      const schedules = await client.schedule.findMany({
        where: { routeId, status: { in: ["OPEN", "DOCUMENTATION"] }, departureAt: { gt: new Date() }, route: { isActive: true }, vehicle: { isActive: true } },
        include: scheduleInclude(),
        orderBy: { departureAt: "asc" }
      });

      return schedules.map(mapSchedule);
    },

    async getSeatMap(scheduleId: string): Promise<SeatMapDto> {
      const schedule = await client.schedule.findUnique({
        where: { id: scheduleId },
        include: scheduleInclude()
      });

      if (!schedule) {
        throw new BookingError("SCHEDULE_NOT_FOUND", "Schedule not found");
      }

      const occupiedSeatIds = new Set((schedule.reservations ?? []).map((item) => item.seatId));
      const occupiedSeatNumbers = new Set((schedule.reservations ?? []).map((item) => item.seatNumber));

      return {
        scheduleId: schedule.id,
        vehicleId: schedule.vehicle.id,
        seats: orderedSeats(schedule.vehicle.seats)
          .map((seat) => ({
            id: seat.id,
            number: seat.number,
            row: seat.row,
            column: seat.column,
            occupied: occupiedSeatIds.has(seat.id) || occupiedSeatNumbers.has(seat.number)
          }))
      };
    },

    async createWebReservation(input: CreateReservationInput) {
      const parsed = createReservationSchema.parse(input);

      for (let attempt = 1; attempt <= MAX_RESERVATION_CODE_ATTEMPTS; attempt += 1) {
        try {
          return await client.$transaction(async (tx) => {
            const schedule = await tx.schedule.findUnique({
              where: { id: parsed.scheduleId },
              include: scheduleInclude()
            });

            if (!schedule) {
              throw new BookingError("SCHEDULE_NOT_FOUND", "Schedule not found");
            }

            if (!["OPEN", "DOCUMENTATION"].includes(schedule.status) || schedule.departureAt <= new Date() || !schedule.route.isActive || schedule.vehicle.isActive === false) {
              throw new BookingError("SCHEDULE_CLOSED", "Schedule is not available for reservations");
            }

            const occupiedSeats = (schedule.reservations ?? [])
              .filter((reservation) => reservation.status !== "CANCELLED")
              .reduce((total, reservation) => total + reservation.passengerCount, 0);
            const requestedSeats = parsed.passengerCount;
            const availableSeats = Math.max(schedule.vehicle.seats.length - occupiedSeats, 0);

            if (requestedSeats > availableSeats) {
              throw new BookingError("CAPACITY_FULL", `Only ${availableSeats} seats are available for this schedule`);
            }

            let seat: (typeof schedule.vehicle.seats)[number] | null = null;
            // El lugar asignado no se ata al vehículo: si el día de la salida mandan otra nave,
            // la reserva sigue siendo válida (el cupo manda, no el plano del coche).
            let seatIdForReservation: string | null = null;
            if (parsed.seatNumber) {
              seat = schedule.vehicle.seats.find((item) => item.number === parsed.seatNumber) ?? null;

              if (!seat) {
                throw new BookingError("SEAT_NOT_FOUND", `Seat ${parsed.seatNumber} does not exist for this schedule`);
              }

              seatIdForReservation = seat.id;

              const existingReservation = await tx.reservation.findFirst({
                where: {
                  scheduleId: schedule.id,
                  OR: [{ seatNumber: seat.number }, { seatId: seat.id }],
                  status: { not: "CANCELLED" }
                }
              });

              if (existingReservation) {
                throw new BookingError("SEAT_OCCUPIED", `Seat ${seat.number} is already occupied`);
              }
            } else {
              // La reserva web no elige asiento: se toma un lugar libre como control interno de cupo.
              const activeReservations = (schedule.reservations ?? []).filter(
                (reservation) => reservation.status !== "CANCELLED"
              );
              seat = firstAvailableSeat(
                schedule.vehicle.seats,
                new Set(activeReservations.map((reservation) => reservation.seatId)),
                new Set(activeReservations.map((reservation) => reservation.seatNumber))
              );

              if (!seat) {
                throw new BookingError("CAPACITY_FULL", "No seats are available for this schedule");
              }
            }

            const passenger = await tx.passenger.create({
              data: parsed.passenger
            });
            const code = createCode();
            const reservation = await tx.reservation.create({
              data: {
                code,
                scheduleId: schedule.id,
                routeId: schedule.routeId,
                passengerId: passenger.id,
                seatId: seatIdForReservation,
                seatNumber: seat?.number ?? null,
                passengerCount: requestedSeats,
                bookingMode: "SEATED",
                status: "PENDING_PAYMENT",
                totalCents: schedule.route.priceCents * requestedSeats,
                currency: schedule.route.currency
              }
            });

            const payment = await paymentProvider.createPendingPayment({
              reservationCode: code,
              amountCents: schedule.route.priceCents * requestedSeats,
              currency: schedule.route.currency
            });
            await tx.payment.create({
              data: {
                reservationId: reservation.id,
                provider: payment.provider,
                status: payment.status,
                amountCents: payment.amountCents,
                currency: payment.currency,
                externalRef: payment.externalRef
              }
            });

            const ticketCode = createTicketCode();
            await tx.ticket.create({
              data: {
                reservationId: reservation.id,
                code: ticketCode,
                qrPayload: JSON.stringify({
                  ticketCode,
                  scheduleId: schedule.id,
                  passengerCount: requestedSeats
                })
              }
            });

            const detail = await getReservationByCodeWithClient(tx, code);

            if (!detail) {
              throw new BookingError("RESERVATION_CREATE_FAILED", "Reservation could not be loaded after creation");
            }

            return detail;
          }, { isolationLevel: "Serializable" });
        } catch (error) {
          if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") {
            if (attempt < MAX_RESERVATION_CODE_ATTEMPTS) continue;
            throw new BookingError("BOOKING_BUSY", "La salida está recibiendo otras reservas. Intentalo nuevamente.");
          }
          if (isSeatUniqueConstraintError(error)) {
            // Con asiento elegido por el usuario, el choque se le informa. Cuando el lugar lo
            // asigna el sistema, se reintenta en una transacción nueva y toma el próximo libre.
            if (!parsed.seatNumber) {
              if (attempt < MAX_RESERVATION_CODE_ATTEMPTS) {
                continue;
              }

              throw new BookingError("BOOKING_BUSY", "La salida está recibiendo otras reservas. Intentalo nuevamente.");
            }

            throw new BookingError("SEAT_OCCUPIED", `Seat ${parsed.seatNumber} is already occupied`);
          }

          if (error instanceof BookingError && error.code === "CAPACITY_FULL") {
            throw error;
          }

          if (isReservationCodeUniqueConstraintError(error)) {
            if (attempt === MAX_RESERVATION_CODE_ATTEMPTS) {
              throw new BookingError("CODE_COLLISION", "Could not generate a unique reservation code");
            }

            continue;
          }

          throw error;
        }
      }

      throw new BookingError("CODE_COLLISION", "Could not generate a unique reservation code");
    },

    async getReservationByCode(code: string) {
      return getReservationByCodeWithClient(client, code);
    },

    async updatePassengerForReservation(code: string, input: PassengerInput) {
      const normalizedCode = code.toUpperCase();
      const parsed = normalizePassengerInput(passengerSchema.parse(input));

      return client.$transaction(async (tx) => {
        const reservation = await tx.reservation.findUnique({
          where: { code: normalizedCode },
          include: reservationInclude()
        });

        if (!reservation) {
          throw new BookingError("RESERVATION_NOT_FOUND", "Reservation not found");
        }

        await tx.passenger.update({
          where: { id: reservation.passengerId },
          data: parsed
        });

        const detail = await getReservationByCodeWithClient(tx, normalizedCode);

        if (!detail) {
          throw new BookingError("RESERVATION_NOT_FOUND", "Reservation not found after passenger update");
        }

        return detail;
      });
    },

    async attachManualPaymentReceipt(
      code: string,
      receipt: {
        blobUrl: string;
        blobPathname: string;
        fileName: string;
        contentType: string;
        size: number;
        uploadedAt: Date;
      }
    ) {
      const normalizedCode = code.toUpperCase();

      for (let attempt = 1; ; attempt += 1) {
        try {
          return await client.$transaction(async (tx) => {
            const reservation = await tx.reservation.findUnique({
              where: { code: normalizedCode },
              include: reservationInclude()
            });

            if (!reservation) {
              throw new BookingError("RESERVATION_NOT_FOUND", "Reservation not found");
            }

            if (!reservation.payment) {
              throw new BookingError("PAYMENT_NOT_FOUND", "Payment not found");
            }

            if (reservation.status !== "PENDING_PAYMENT" || reservation.payment.provider !== "MANUAL" || reservation.payment.status !== "PENDING") {
              throw new BookingError("PAYMENT_LOCKED", "El pago ya no admite comprobantes.");
            }

            const replacedBlobPathname = reservation.payment.receiptBlobPathname ?? null;
            await tx.payment.update({
              where: { reservationId: reservation.id },
              data: {
                status: "PENDING",
                receiptBlobUrl: receipt.blobUrl,
                receiptBlobPathname: receipt.blobPathname,
                receiptFileName: receipt.fileName,
                receiptContentType: receipt.contentType,
                receiptSize: receipt.size,
                receiptUploadedAt: receipt.uploadedAt
              }
            });

            const detail = await getReservationByCodeWithClient(tx, normalizedCode);

            if (!detail) {
              throw new BookingError("RESERVATION_NOT_FOUND", "Reservation not found after receipt upload");
            }

            return { reservation: detail, replacedBlobPathname };
          }, { isolationLevel: "Serializable" });
        } catch (error) {
          // Two uploads for the same payment conflict under Serializable: retry, then report it.
          if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") {
            if (attempt < MAX_RESERVATION_CODE_ATTEMPTS) continue;
            throw new BookingError("BOOKING_BUSY", "Recibimos otro comprobante para esta reserva al mismo tiempo. Intentalo nuevamente.");
          }
          throw error;
        }
      }
    },

    async approveManualPayment(code: string) {
      const normalizedCode = code.toUpperCase();

      return client.$transaction(async (tx) => {
        const reservation = await tx.reservation.findUnique({
          where: { code: normalizedCode },
          include: reservationInclude()
        });

        if (!reservation) {
          throw new BookingError("RESERVATION_NOT_FOUND", "Reservation not found");
        }

        if (!reservation.payment) {
          throw new BookingError("PAYMENT_NOT_FOUND", "Payment not found");
        }

        if (!reservation.payment.receiptBlobPathname) {
          throw new BookingError("RECEIPT_NOT_FOUND", "Manual payment receipt not found");
        }

        await tx.payment.update({
          where: { reservationId: reservation.id },
          data: {
            status: "APPROVED"
          }
        });
        await tx.reservation.update({
          where: { id: reservation.id },
          data: {
            status: "CONFIRMED"
          }
        });

        const detail = await getReservationByCodeWithClient(tx, normalizedCode);

        if (!detail) {
          throw new BookingError("RESERVATION_NOT_FOUND", "Reservation not found after payment approval");
        }

        return detail;
      });
    },

    async listAdminSchedules(): Promise<AdminScheduleRowDto[]> {
      const schedules = await client.schedule.findMany({
        include: scheduleInclude(),
        orderBy: { departureAt: "asc" }
      });

      return schedules.map((schedule) => {
        const option = mapSchedule(schedule);
        return {
          id: schedule.id,
          routeId: schedule.routeId,
          vehicleId: schedule.vehicleId,
          route: `${schedule.route.from} -> ${schedule.route.to}`,
          departureAt: schedule.departureAt,
          arrivalAt: schedule.arrivalAt,
          status: schedule.status,
          availableSeats: option.availableSeats,
          totalSeats: option.totalSeats
        };
      });
    },

    async listAdminRoutes(): Promise<AdminRouteRowDto[]> {
      const routes = await client.travelRoute.findMany({
        where: { bookingMode: { not: "CHAPELCO" } },
        include: {
          _count: {
            select: {
              schedules: true
            }
          }
        },
        orderBy: [{ isActive: "desc" }, { featured: "desc" }, { from: "asc" }, { to: "asc" }, { slug: "asc" }]
      });

      return routes.map((route) => ({
        ...mapRoute(route),
        isActive: route.isActive,
        scheduleCount: route._count?.schedules ?? 0
      }));
    },

    async listAdminReservations(): Promise<AdminReservationRowDto[]> {
      const reservations = await client.reservation.findMany({
        include: reservationInclude(),
        orderBy: { createdAt: "desc" }
      });

      return reservations.map((reservation) => ({
        id: reservation.id,
        code: reservation.code,
        passenger: `${reservation.passenger.firstName} ${reservation.passenger.lastName}`,
        passengerPhone: reservation.passenger.phone,
        route: reservation.schedule
          ? `${reservation.schedule.route.from} -> ${reservation.schedule.route.to}`
          : reservation.route
            ? `${reservation.route.from} -> ${reservation.route.to}`
            : "Ruta sin datos",
        departureAt: reservation.schedule?.departureAt ?? reservation.chapelcoDetails?.serviceDate ?? reservation.createdAt,
        seatNumber: reservation.seatNumber,
        bookingMode: reservation.bookingMode,
        passengerCount: reservation.passengerCount,
        chapelcoPickupName: reservation.chapelcoDetails?.pickupName ?? null,
        chapelcoAscentSlot: reservation.chapelcoDetails?.ascentSlot ?? null,
        status: reservation.status,
        paymentStatus: reservation.payment?.status ?? null,
        hasReceipt: Boolean(reservation.payment?.receiptBlobPathname),
        receiptFileName: reservation.payment?.receiptFileName ?? null,
        receiptUploadedAt: reservation.payment?.receiptUploadedAt ?? null,
        createdAt: reservation.createdAt
      }));
    }
  };
}

const defaultRepository = createBookingRepository(prisma as unknown as BookingClient);

export const listPublicRoutes = defaultRepository.listPublicRoutes;
export const getPublicRouteBySlug = defaultRepository.getPublicRouteBySlug;
export const listSchedulesForRoute = defaultRepository.listSchedulesForRoute;
export const getSeatMap = defaultRepository.getSeatMap;
export const createWebReservation = defaultRepository.createWebReservation;
export const getReservationByCode = defaultRepository.getReservationByCode;
export const updatePassengerForReservation = defaultRepository.updatePassengerForReservation;
export const attachManualPaymentReceipt = defaultRepository.attachManualPaymentReceipt;
export const approveManualPayment = defaultRepository.approveManualPayment;
export const listAdminSchedules = defaultRepository.listAdminSchedules;
export const listAdminRoutes = defaultRepository.listAdminRoutes;
export const listAdminReservations = defaultRepository.listAdminReservations;
