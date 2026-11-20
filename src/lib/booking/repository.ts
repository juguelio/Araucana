import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mismoLugar } from "./place-names";
import { extraUnitsCountInclude, extraUnitsSeatsInclude, scheduleSeatCount, scheduleSeatPool } from "./schedule-units";
import { adminReservationsPageSize, normalizarBusqueda, travelDayKey, adminReservationWhere, adminReservationsPage, adminScheduleWhere, type AdminReservationFilters, type AdminScheduleFilters } from "./admin-filters";
import { adminReservationOrder, adminReservationOrderBy } from "./admin-reservation-sort";
import { claveDeViaje, horaDelViaje, ordenarPorViaje, type ClaveDeViaje } from "./admin-travel-order";
import { prisma } from "@/lib/db/prisma";
import { createReservationCode as defaultCreateReservationCode, createReservationShortCode as defaultCreateReservationShortCode, createTicketCode } from "./codes";
import {
  AdminRouteRowDto,
  AdminReservationsPageDto,
  AdminScheduleRowDto,
  PublicRouteDto,
  ReservationDetailDto,
  ScheduleOptionDto,
  SeatMapDto
} from "./types";
import { fareCounts, reservationTotalCents, seatsFromFares } from "./passenger-fares";
import { adminPassengerSchema, adminReservationSchema, adminRouteRoundTripSchema, createReservationSchema, type AdminReservationInput, type AdminRouteRoundTripInput, type PassengerInput } from "./validation";
import { manualPaymentProvider } from "@/lib/payments/manual-provider";
import { DISABILITY_DOCUMENT_PROVIDER, DISABILITY_PENDING_STATUS, receiptPendingStatus } from "./disability-fare";
import { diffRecords, hasChanges } from "@/lib/audit/diff";
import { guestActor, recordAudit, type AuditActor, type AuditClient } from "@/lib/audit/record";
import { recordReservationCreated, withShortCode } from "@/lib/audit/reservation";
import { reservationCreatorData, reservationCreatorLabel, type ReservationCreationContext } from "./reservation-creator";
import { getStopFares } from "./stop-fares";
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
  extraUnits?: Array<{ vehicle: { id: string; isActive?: boolean; seats: SeatRecord[] } }>;
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
  method?: string | null;
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
  shortCode: string;
  roundTripId?: string | null;
  referredBy?: string | null;
  scheduleId: string | null;
  routeId?: string | null;
  passengerId: string;
  dropoffStop?: string | null;
  seatId: string | null;
  seatNumber: string | null;
  passengerCount: number;
  halfFareCount?: number;
  freeFareCount?: number;
  bookingMode: string;
  status: string;
  cancellationReason?: string | null;
  cancelledAt?: Date | null;
  cancelledByName?: string | null;
  /** Restitución (#117): quién y cuándo volvió atrás. La cancelación no se borra. */
  restoredAt?: Date | null;
  restoredByName?: string | null;
  totalCents: number;
  currency: string;
  createdAt: Date;
  createdByName?: string | null;
  createdByRole?: string | null;
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
    halfFareCount?: number;
    sportsLuggageCount?: number;
    sportsLuggageUnitCents?: number;
    zoneExtraCents?: number;
    flightId?: string | null;
    flightNumber: string;
    direction: string;
    serviceDate: Date;
    pickupName?: string | null;
    pickupAddress?: string | null;
    pickupLatitude?: number | null;
    pickupLongitude?: number | null;
    pickupNotes?: string | null;
    flight?: { scheduledAt: Date; estimatedAt: Date | null; status: string; pickupStartOverrideAt?: Date | null } | null;
  } | null;
};

/** Lo que hace falta para crear un tramo de salida regular (ver `crearTramoDeSalida`). */
type TramoDeSalida = {
  scheduleId: string;
  dropoffStop?: string;
  seatNumber?: string;
  passengerCount: number;
  halfFareCount?: number;
  freeFareCount?: number;
  requestDisabilityFare?: boolean;
  overrideTotalCents?: number;
  referredBy?: string | null;
  /** El pasajero a crear, o el ya creado (el ida y vuelta lo crea una vez para los dos tramos). */
  pasajero: { data: AdminReservationInput["passenger"] } | { id: string };
  roundTripId?: string;
  creator?: ReservationCreationContext["creator"];
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
    count(args?: unknown): Promise<number>;
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
  /** Opcional: los clientes falsos de las pruebas no lo traen (ver `recordAudit`). */
  auditLog?: AuditClient["auditLog"];
};

export type BookingClient = BookingTransactionClient & {
  // Búsqueda sin tildes (ver listAdminReservations): Prisma no expone translate() en el where.
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $transaction<T>(callback: (client: BookingTransactionClient) => Promise<T>, options?: { isolationLevel: "Serializable" }): Promise<T>;
};

type BookingRepositoryDeps = {
  createReservationCode?: () => string;
  createReservationShortCode?: () => string;
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

/**
 * `code` es la capability del link privado y `shortCode` el lookup del panel: los dos se
 * regeneran en el intento siguiente, así que un choque de cualquiera es reintentable.
 */
function isReservationCodeUniqueConstraintError(error: unknown) {
  if (!isUniqueConstraintError(error)) {
    return false;
  }

  const targets = uniqueConstraintTargets(error);
  return uniqueConstraintHasFields(targets, ["code"]) || uniqueConstraintHasFields(targets, ["shortCode"]);
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

/** Lo mínimo para calcular el cupo de una salida en un listado (ver scheduleSummaryInclude). */
type ScheduleSummaryRecord = Omit<ScheduleRecord, "vehicle" | "reservations" | "extraUnits"> & {
  vehicle: {
    id: string;
    isActive?: boolean;
    name: string;
    licensePlate?: string | null;
    internalNumber?: string | null;
    seats?: SeatRecord[];
    _count?: { seats: number };
  };
  extraUnits?: Array<{ vehicle: { id: string; isActive?: boolean; name: string; _count?: { seats: number } } }>;
  reservations?: Array<{ status: string; passengerCount: number }>;
};

function mapSchedule(schedule: ScheduleSummaryRecord): ScheduleOptionDto {
  const totalSeats = scheduleSeatCount(schedule);
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
    shortCode: reservation.shortCode,
    roundTripId: reservation.roundTripId ?? null,
    referredBy: reservation.referredBy ?? null,
    bookingMode: reservation.bookingMode,
    dropoffStop: reservation.dropoffStop ?? null,
    passengerCount: reservation.passengerCount,
    halfFareCount: reservation.halfFareCount ?? 0,
    freeFareCount: reservation.freeFareCount ?? 0,
    status: reservation.status,
    cancellationReason: reservation.cancellationReason ?? null,
    cancelledAt: reservation.cancelledAt ?? null,
    cancelledByName: reservation.cancelledByName ?? null,
    restoredAt: reservation.restoredAt ?? null,
    restoredByName: reservation.restoredByName ?? null,
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
          method: reservation.payment.method,
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
          halfFareCount: reservation.airportDetails.halfFareCount ?? 0,
          sportsLuggageCount: reservation.airportDetails.sportsLuggageCount ?? 0,
          sportsLuggageUnitCents: reservation.airportDetails.sportsLuggageUnitCents ?? 0,
          zoneExtraCents: reservation.airportDetails.zoneExtraCents ?? 0,
          flightId: reservation.airportDetails.flightId ?? null,
          flightNumber: reservation.airportDetails.flightNumber,
          direction: reservation.airportDetails.direction,
          serviceDate: reservation.airportDetails.serviceDate,
          pickupName: reservation.airportDetails.pickupName,
          pickupAddress: reservation.airportDetails.pickupAddress,
          pickupLatitude: reservation.airportDetails.pickupLatitude,
          pickupLongitude: reservation.airportDetails.pickupLongitude,
          pickupNotes: reservation.airportDetails.pickupNotes,
          flight: reservation.airportDetails.flight
            ? {
                scheduledAt: reservation.airportDetails.flight.scheduledAt,
                estimatedAt: reservation.airportDetails.flight.estimatedAt,
                status: reservation.airportDetails.flight.status,
                pickupStartOverrideAt: reservation.airportDetails.flight.pickupStartOverrideAt ?? null
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

/**
 * Para la tabla de reservas del panel: sólo las columnas que muestra. reservationInclude() traía
 * además la nave con todos sus asientos y el ticket de cada fila, y cada relación es otro viaje a la base.
 */
function adminReservationListInclude() {
  return {
    schedule: { select: { departureAt: true, route: { select: { from: true, to: true } } } },
    route: { select: { from: true, to: true } },
    passenger: { select: { firstName: true, lastName: true, phone: true, documentId: true } },
    payment: { select: { provider: true, status: true, receiptBlobPathname: true, receiptFileName: true, receiptUploadedAt: true } },
    chapelcoDetails: { select: { serviceDate: true, pickupName: true, ascentSlot: true } },
    airportDetails: { select: { serviceDate: true, flightNumber: true, flight: { select: { scheduledAt: true } } } }
  };
}

/** Lo mínimo para ordenar el listado por día y hora del viaje (`admin-travel-order.ts`). */
function adminTravelOrderSelect() {
  return {
    id: true,
    code: true,
    createdAt: true,
    schedule: { select: { departureAt: true } },
    airportDetails: { select: { serviceDate: true, flight: { select: { scheduledAt: true } } } },
    chapelcoDetails: { select: { serviceDate: true } }
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
    extraUnits: extraUnitsSeatsInclude,
    reservations: true
  };
}

/**
 * Para listados de salidas (web y panel): la cantidad de asientos de la nave y los lugares tomados.
 * scheduleInclude() traía cada asiento de la nave y cada reserva completa de cada salida sólo para
 * contarlos; con cientos de salidas por ruta eran miles de filas por pantalla.
 */
function scheduleSummaryInclude() {
  return {
    route: true,
    vehicle: {
      select: { id: true, isActive: true, name: true, licensePlate: true, internalNumber: true, _count: { select: { seats: true } } }
    },
    extraUnits: extraUnitsCountInclude,
    reservations: { select: { status: true, passengerCount: true } }
  };
}

function compareSeats(left: SeatRecord & { unit?: number }, right: SeatRecord & { unit?: number }) {
  return (left.unit ?? 1) - (right.unit ?? 1) || left.row - right.row || left.column - right.column || left.number.localeCompare(right.number);
}

function orderedSeats<T extends SeatRecord & { unit?: number }>(seats: T[]): T[] {
  return [...seats].sort(compareSeats);
}

/**
 * Control interno de cupo: la reserva web no elige asiento y el pasajero nunca ve un número.
 * El negocio carga la nave por orden de llegada y decide qué vehículo manda, así que el lugar
 * asignado sólo sirve para no sobrevender ni duplicar el mismo lugar en la misma salida.
 * Devuelve el primer lugar libre en el mismo orden en que se muestra el mapa de asientos.
 *
 * Lo usa también la restitución de una reserva cancelada (#117): el asiento se libera al cancelar,
 * así que al volver hay que darle uno libre de la misma salida.
 */
export function firstAvailableSeat<T extends SeatRecord & { unit?: number }>(
  seats: T[],
  occupiedSeatIds: Set<string | null>,
  occupiedSeatNumbers: Set<string | null>
) {
  return (
    orderedSeats(seats).find((seat) => !occupiedSeatIds.has(seat.id) && !occupiedSeatNumbers.has(seat.number)) ?? null
  );
}

function findReservationByCode(client: BookingTransactionClient, code: string) {
  return client.reservation.findUnique({
    where: { code },
    include: reservationInclude()
  });
}

/**
 * El otro tramo del ida y vuelta. El voucher (#166) lo imprime en la misma tabla que el propio, así
 * que trae los datos del servicio; el panel sólo usa `code`/`shortCode` para saltar de uno al otro.
 */
async function tramoCompanero(client: BookingTransactionClient, roundTripId: string, idActual: string) {
  const socio = await client.reservation.findFirst({
    where: { roundTripId, id: { not: idActual } },
    select: {
      code: true,
      shortCode: true,
      status: true,
      totalCents: true,
      payment: { select: { status: true, amountCents: true, provider: true } },
      airportDetails: {
        select: {
          direction: true,
          flightNumber: true,
          serviceDate: true,
          pickupName: true,
          pickupAddress: true,
          pickupNotes: true,
          flight: {
            select: { scheduledAt: true, estimatedAt: true, status: true, pickupStartOverrideAt: true }
          }
        }
      }
    }
  });
  if (!socio) return null;

  const airport = socio.airportDetails;
  return {
    code: socio.code,
    shortCode: socio.shortCode,
    status: socio.status,
    totalCents: socio.totalCents,
    payment: socio.payment ?? null,
    direction: airport?.direction ?? null,
    airport: airport
      ? {
          direction: airport.direction ?? null,
          flightNumber: airport.flightNumber,
          serviceDate: airport.serviceDate,
          pickupName: airport.pickupName ?? null,
          pickupAddress: airport.pickupAddress ?? null,
          pickupNotes: airport.pickupNotes ?? null,
          flight: airport.flight ?? null
        }
      : null
  };
}

async function getReservationByCodeWithClient(client: BookingTransactionClient, code: string) {
  const reservation = await findReservationByCode(client, code);
  if (!reservation) return null;

  const detalle = mapReservation(reservation);
  if (!reservation.roundTripId) return { ...detalle, roundTripPartner: null };

  return { ...detalle, roundTripPartner: await tramoCompanero(client, reservation.roundTripId, reservation.id) };
}

export function createBookingRepository(client: BookingClient, deps: BookingRepositoryDeps = {}) {
  const createCode = deps.createReservationCode ?? (() => defaultCreateReservationCode());
  const createShortCode = deps.createReservationShortCode ?? (() => defaultCreateReservationShortCode());
  const paymentProvider = deps.paymentProvider ?? manualPaymentProvider;

  async function issueScheduleTicket(tx: BookingTransactionClient, reservationId: string, scheduleId: string, passengerCount: number) {
    const ticketCode = createTicketCode();
    await tx.ticket.create({
      data: {
        reservationId,
        code: ticketCode,
        qrPayload: JSON.stringify({ ticketCode, scheduleId, passengerCount })
      }
    });
  }

  /**
   * Un tramo de salida regular, dentro de una transacción ya abierta: valida la salida y el cupo, crea
   * la reserva con su pago pendiente y su pasaje, y devuelve el código. La usan la reserva de un tramo
   * y el ida y vuelta de rutas (pedido de Jugue, 18-nov), que crea dos tramos en la misma transacción.
   */
  async function crearTramoDeSalida(tx: BookingTransactionClient, tramo: TramoDeSalida) {
    const schedule = await tx.schedule.findUnique({
      where: { id: tramo.scheduleId },
      include: scheduleInclude()
    });

    if (!schedule) {
      throw new BookingError("SCHEDULE_NOT_FOUND", "Schedule not found");
    }

    if (!["OPEN", "DOCUMENTATION"].includes(schedule.status) || schedule.departureAt <= new Date() || !schedule.route.isActive || schedule.vehicle.isActive === false) {
      throw new BookingError("SCHEDULE_CLOSED", "Schedule is not available for reservations");
    }

    // El aeropuerto no se reserva por salida horaria (issue #79): sin número de vuelo la
    // reserva no tiene recorrida (2 h 30 antes del despegue) ni combi. Va acá y no sólo en
    // el formulario porque un `scheduleId` armado a mano tiene que rebotar igual.
    if (schedule.route.bookingMode === "AIRPORT") {
      throw new BookingError(
        "AIRPORT_SCHEDULE_NOT_BOOKABLE",
        "Las reservas de aeropuerto se cargan desde «Crear reserva de aeropuerto», eligiendo el vuelo."
      );
    }

    const occupiedSeats = (schedule.reservations ?? [])
      .filter((reservation) => reservation.status !== "CANCELLED")
      .reduce((total, reservation) => total + reservation.passengerCount, 0);
    const requestedSeats = tramo.passengerCount;
    const stop = tramo.dropoffStop && schedule.route.bookingMode === "SEATED"
      ? getStopFares(schedule.route).find((fare) => fare.name === tramo.dropoffStop)
      : undefined;
    if (tramo.dropoffStop && !stop) {
      throw new BookingError("STOP_NOT_AVAILABLE", "La parada seleccionada ya no está disponible.");
    }
    const disabilityFare = tramo.requestDisabilityFare === true;
    const fares = fareCounts(requestedSeats, tramo.halfFareCount, tramo.freeFareCount);
    if (disabilityFare && (schedule.route.bookingMode !== "SEATED" || requestedSeats !== 1 || seatsFromFares(fares) !== 1 || fares.half || fares.free)) {
      throw new BookingError("DISABILITY_FARE_NOT_AVAILABLE", "La solicitud de viaje gratuito corresponde a un pasajero de transporte público.");
    }
    const totalCents = disabilityFare
      ? 0
      : tramo.overrideTotalCents ?? reservationTotalCents(stop?.priceCents ?? schedule.route.priceCents, fares);
    // El cupo es el de todas las naves de la salida, no sólo el de la principal.
    const seatPool = scheduleSeatPool(schedule);
    const availableSeats = Math.max(seatPool.length - occupiedSeats, 0);

    if (requestedSeats > availableSeats) {
      throw new BookingError("CAPACITY_FULL", `Only ${availableSeats} seats are available for this schedule`);
    }

    let seat: (typeof seatPool)[number] | null = null;
    // El lugar asignado no se ata al vehículo: si el día de la salida mandan otra nave,
    // la reserva sigue siendo válida (el cupo manda, no el plano del coche).
    let seatIdForReservation: string | null = null;
    if (tramo.seatNumber) {
      seat = seatPool.find((item) => item.number === tramo.seatNumber) ?? null;

      if (!seat) {
        throw new BookingError("SEAT_NOT_FOUND", `Seat ${tramo.seatNumber} does not exist for this schedule`);
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
        seatPool,
        new Set(activeReservations.map((reservation) => reservation.seatId)),
        new Set(activeReservations.map((reservation) => reservation.seatNumber))
      );

      if (!seat) {
        throw new BookingError("CAPACITY_FULL", "No seats are available for this schedule");
      }
    }

    // El ida y vuelta carga al pasajero una vez y lo comparte entre los dos tramos.
    const passengerId = "id" in tramo.pasajero
      ? tramo.pasajero.id
      : (await tx.passenger.create({ data: tramo.pasajero.data })).id;
    const code = createCode();
    const reservation = await tx.reservation.create({
      data: {
        code,
        shortCode: createShortCode(),
        ...reservationCreatorData(tramo.creator),
        scheduleId: schedule.id,
        routeId: schedule.routeId,
        passengerId,
        // Los dos tramos de un ida y vuelta comparten la clave del viaje (como en el aeropuerto).
        ...(tramo.roundTripId ? { roundTripId: tramo.roundTripId } : {}),
        seatId: seatIdForReservation,
        seatNumber: seat?.number ?? null,
        // Derivación de otra agencia (#109): sólo llega por el alta del panel; el
        // formulario público no declara quién vendió.
        referredBy: tramo.referredBy || null,
        passengerCount: requestedSeats,
        halfFareCount: fares.half,
        freeFareCount: fares.free,
        bookingMode: "SEATED",
        status: disabilityFare ? DISABILITY_PENDING_STATUS : "PENDING_PAYMENT",
        ...(stop ? { dropoffStop: stop.name } : {}),
        totalCents,
        currency: schedule.route.currency
      }
    });

    const payment = disabilityFare
      ? { provider: DISABILITY_DOCUMENT_PROVIDER, status: "PENDING", amountCents: 0, currency: schedule.route.currency, externalRef: null }
      : await paymentProvider.createPendingPayment({
      reservationCode: code,
      amountCents: totalCents,
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

    if (!disabilityFare) await issueScheduleTicket(tx, reservation.id, schedule.id, requestedSeats);
    await recordReservationCreated(tx, reservation, tramo.creator, "salida regular");

    return code;
  }

  async function reviewReceipt(code: string, decision: "APPROVED" | "REJECTED", provider = "MANUAL", receiptVersion?: string, actor?: AuditActor | null) {
    const normalizedCode = code.trim().toUpperCase();
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await client.$transaction(async (tx) => {
          const reservation = await tx.reservation.findUnique({
            where: { code: normalizedCode }, include: reservationInclude()
          });
          if (!reservation) throw new BookingError("RESERVATION_NOT_FOUND", "Reserva no encontrada.");
          if (!reservation.payment) throw new BookingError("PAYMENT_NOT_FOUND", "Pago no encontrado.");
          const pendingStatus = receiptPendingStatus(provider);
          if (reservation.status !== pendingStatus || reservation.payment.provider !== provider || reservation.payment.status !== "PENDING") {
            throw new BookingError("PAYMENT_LOCKED", "El pago ya fue revisado o la reserva no admite cambios.");
          }
          if (!reservation.payment.receiptBlobPathname) {
            throw new BookingError("RECEIPT_NOT_FOUND", "No encontramos el comprobante para revisar ese pago.");
          }
          if (provider === DISABILITY_DOCUMENT_PROVIDER) {
            if (!receiptVersion || reservation.payment.receiptUploadedAt?.toISOString() !== receiptVersion) {
              throw new BookingError("RECEIPT_CHANGED", "El comprobante cambió. Abrilo de nuevo antes de resolver la solicitud.");
            }
            if (decision === "APPROVED") {
              if (!reservation.scheduleId) throw new BookingError("SCHEDULE_NOT_FOUND", "La reserva no tiene una salida asignada.");
              await issueScheduleTicket(tx, reservation.id, reservation.scheduleId, reservation.passengerCount);
            }
          }
          // La foto de antes se toma antes de escribir: no depende de que `reservation` siga intacto.
          const beforeReview = { status: reservation.status, "payment.status": reservation.payment.status };
          await tx.payment.update({ where: { reservationId: reservation.id }, data: { status: decision } });
          const nextStatus = decision === "APPROVED" ? "CONFIRMED" : pendingStatus;
          await tx.reservation.update({
            where: { id: reservation.id },
            data: { status: nextStatus }
          });
          const disability = provider === DISABILITY_DOCUMENT_PROVIDER;
          await recordAudit(tx, {
            actor,
            action: disability
              ? (decision === "APPROVED" ? "DOCUMENT_APPROVED" : "DOCUMENT_REJECTED")
              : (decision === "APPROVED" ? "PAYMENT_APPROVED" : "PAYMENT_REJECTED"),
            entity: "RESERVATION",
            entityId: reservation.id,
            entityLabel: normalizedCode,
            summary: withShortCode(disability
              ? (decision === "APPROVED" ? "Documentación aprobada: reserva sin cargo confirmada." : "Documentación rechazada.")
              : (decision === "APPROVED" ? "Comprobante de pago validado." : "Comprobante de pago rechazado."), reservation.shortCode),
            changes: diffRecords(beforeReview, { status: nextStatus, "payment.status": decision })
          });
          const detail = await getReservationByCodeWithClient(tx, normalizedCode);
          if (!detail) throw new BookingError("RESERVATION_NOT_FOUND", "Reserva no encontrada.");
          return detail;
        }, { isolationLevel: "Serializable" });
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") {
          if (attempt < MAX_RESERVATION_CODE_ATTEMPTS) continue;
          throw new BookingError("BOOKING_BUSY", "Otro operador está actualizando el pago. Volvé a consultar la reserva.");
        }
        throw error;
      }
    }
  }

  return {
    async listPublicRoutes() {
      const routes = await client.travelRoute.findMany({
        // CHAPELCO y AIRPORT tienen su propio flujo (el aeropuerto se reserva por vuelo, no por horario).
        where: { isActive: true, bookingMode: { notIn: ["CHAPELCO", "AIRPORT"] } },
        orderBy: [{ featured: "desc" }, { from: "asc" }, { to: "asc" }, { slug: "asc" }]
      });

      return routes.map(mapRoute);
    },

    /** Tramos de aeropuerto activos: el buscador público los ofrece como acceso directo al flujo por vuelo. */
    async listPublicAirportRoutes() {
      const routes = await client.travelRoute.findMany({
        where: { isActive: true, bookingMode: "AIRPORT" },
        orderBy: [{ from: "asc" }, { to: "asc" }, { slug: "asc" }]
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
      const schedules = (await client.schedule.findMany({
        where: { routeId, status: { in: ["OPEN", "DOCUMENTATION"] }, departureAt: { gt: new Date() }, route: { isActive: true }, vehicle: { isActive: true } },
        include: scheduleSummaryInclude(),
        orderBy: { departureAt: "asc" }
      })) as unknown as ScheduleSummaryRecord[];

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
        seats: orderedSeats(scheduleSeatPool(schedule))
          .map((seat) => ({
            id: seat.id,
            number: seat.number,
            row: seat.row,
            column: seat.column,
            occupied: occupiedSeatIds.has(seat.id) || occupiedSeatNumbers.has(seat.number)
          }))
      };
    },

    async createWebReservation(input: AdminReservationInput, { fromAdmin, creator }: ReservationCreationContext = {}) {
      const parsed: AdminReservationInput = (fromAdmin ? adminReservationSchema : createReservationSchema).parse(input);

      for (let attempt = 1; attempt <= MAX_RESERVATION_CODE_ATTEMPTS; attempt += 1) {
        try {
          return await client.$transaction(async (tx) => {
            const code = await crearTramoDeSalida(tx, {
              ...parsed,
              pasajero: { data: parsed.passenger },
              creator
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

    /**
     * Ida y vuelta de una ruta regular desde el panel (pedido de Jugue, 18-nov). **Una sola
     * transacción** crea los dos tramos con el pasajero cargado una vez (un `Passenger`, dos
     * `Reservation` con el mismo `roundTripId`), igual que el ida y vuelta del aeropuerto: cada tramo
     * tiene su pago pendiente y su pasaje, y se cancela por separado. Si un tramo falla (sin cupo,
     * salida cerrada), no queda ninguno.
     *
     * - La vuelta es la ruta inversa (sale de donde llega la ida y llega a donde sale) y sale después.
     * - El precio ajustado por administración es el total del viaje: se reparte mitad por tramo.
     */
    async createRouteRoundTripReservation(input: AdminRouteRoundTripInput, { creator }: ReservationCreationContext = {}) {
      const parsed = adminRouteRoundTripSchema.parse(input);
      const total = parsed.overrideTotalCents;
      const precioIda = total === undefined ? undefined : Math.floor(total / 2);
      const precioVuelta = total === undefined || precioIda === undefined ? undefined : total - precioIda;
      const comun = {
        passengerCount: parsed.passengerCount,
        halfFareCount: parsed.halfFareCount,
        freeFareCount: parsed.freeFareCount,
        requestDisabilityFare: parsed.requestDisabilityFare,
        referredBy: parsed.referredBy,
        creator
      };

      for (let attempt = 1; attempt <= MAX_RESERVATION_CODE_ATTEMPTS; attempt += 1) {
        try {
          return await client.$transaction(async (tx) => {
            const [ida, vuelta] = await Promise.all([
              tx.schedule.findUnique({ where: { id: parsed.scheduleId }, include: scheduleInclude() }),
              tx.schedule.findUnique({ where: { id: parsed.returnScheduleId }, include: scheduleInclude() })
            ]);
            if (!ida || !vuelta) throw new BookingError("SCHEDULE_NOT_FOUND", "Schedule not found");
            // Sin tildes ni mayúsculas: «San Martin» y «San Martín» son el mismo lugar (19-nov).
            if (!mismoLugar(vuelta.route.from, ida.route.to) || !mismoLugar(vuelta.route.to, ida.route.from)) {
              throw new BookingError(
                "ROUND_TRIP_ROUTE_MISMATCH",
                `La vuelta tiene que salir de ${ida.route.to} y llegar a ${ida.route.from}.`
              );
            }
            if (vuelta.departureAt <= ida.departureAt) {
              throw new BookingError("INVALID_ROUND_TRIP_ORDER", "La salida de la vuelta tiene que ser después de la de ida.");
            }

            const roundTripId = randomUUID();
            const passenger = await tx.passenger.create({ data: parsed.passenger });
            const codigoIda = await crearTramoDeSalida(tx, {
              ...comun,
              scheduleId: ida.id,
              dropoffStop: parsed.dropoffStop,
              overrideTotalCents: precioIda,
              pasajero: { id: passenger.id },
              roundTripId
            });
            const codigoVuelta = await crearTramoDeSalida(tx, {
              ...comun,
              scheduleId: vuelta.id,
              dropoffStop: parsed.returnDropoffStop,
              overrideTotalCents: precioVuelta,
              pasajero: { id: passenger.id },
              roundTripId
            });

            const [detalleIda, detalleVuelta] = await Promise.all([
              getReservationByCodeWithClient(tx, codigoIda),
              getReservationByCodeWithClient(tx, codigoVuelta)
            ]);
            if (!detalleIda || !detalleVuelta) {
              throw new BookingError("RESERVATION_CREATE_FAILED", "Reservation could not be loaded after creation");
            }
            return { roundTripId, ida: detalleIda, vuelta: detalleVuelta };
          }, { isolationLevel: "Serializable" });
        } catch (error) {
          // Mismos reintentos que la reserva de un tramo: conflicto de serialización, lugar tomado
          // en simultáneo o código repetido se reintentan en una transacción nueva.
          const reintentable = (typeof error === "object" && error !== null && "code" in error && error.code === "P2034")
            || isSeatUniqueConstraintError(error)
            || isReservationCodeUniqueConstraintError(error);
          if (reintentable && attempt < MAX_RESERVATION_CODE_ATTEMPTS) continue;
          if (reintentable) throw new BookingError("BOOKING_BUSY", "La salida está recibiendo otras reservas. Intentalo nuevamente.");
          throw error;
        }
      }

      throw new BookingError("BOOKING_BUSY", "La salida está recibiendo otras reservas. Intentalo nuevamente.");
    },

    async getReservationByCode(code: string) {
      return getReservationByCodeWithClient(client, code);
    },

    async getAdminReservationByCode(code: string) {
      const reservation = await findReservationByCode(client, code);
      if (!reservation) return null;

      const detalle = { ...mapReservation(reservation), creatorLabel: reservationCreatorLabel(reservation) };
      if (!reservation.roundTripId) return { ...detalle, roundTripPartner: null };

      // Ida y vuelta (#36): el panel muestra el otro tramo del viaje para saltar de uno al otro.
      return {
        ...detalle,
        roundTripPartner: await tramoCompanero(client, reservation.roundTripId, reservation.id)
      };
    },

    async updatePassengerForReservation(code: string, input: PassengerInput, actor?: AuditActor | null) {
      const normalizedCode = code.toUpperCase();
      const parsed = normalizePassengerInput(adminPassengerSchema.parse(input));

      return client.$transaction(async (tx) => {
        const reservation = await tx.reservation.findUnique({
          where: { code: normalizedCode },
          include: reservationInclude()
        });

        if (!reservation) {
          throw new BookingError("RESERVATION_NOT_FOUND", "Reservation not found");
        }

        const previous = reservation.passenger as unknown as Record<string, unknown>;
        const beforeEdit = Object.fromEntries(Object.keys(parsed).map((field) => [`passenger.${field}`, previous?.[field]]));
        await tx.passenger.update({
          where: { id: reservation.passengerId },
          data: parsed
        });

        const changes = diffRecords(
          beforeEdit,
          Object.fromEntries(Object.entries(parsed).map(([field, value]) => [`passenger.${field}`, value]))
        );
        if (hasChanges(changes)) {
          await recordAudit(tx, {
            actor,
            action: "UPDATE",
            entity: "RESERVATION",
            entityId: reservation.id,
            entityLabel: normalizedCode,
            summary: withShortCode("Datos del pasajero editados.", reservation.shortCode),
            changes
          });
        }

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

            if (reservation.status !== receiptPendingStatus(reservation.payment.provider) || !["PENDING", "REJECTED"].includes(reservation.payment.status)) {
              throw new BookingError("PAYMENT_LOCKED", "El pago ya no admite comprobantes.");
            }

            const replacedBlobPathname = reservation.payment.receiptBlobPathname ?? null;
            const beforeUpload = { "payment.status": reservation.payment.status, "payment.receiptFileName": reservation.payment.receiptFileName ?? null };
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
            // Lo sube el pasajero desde su enlace, sin sesión. Queda el nombre del archivo, no el archivo.
            await recordAudit(tx, {
              actor: guestActor,
              action: "UPDATE",
              entity: "RESERVATION",
              entityId: reservation.id,
              entityLabel: normalizedCode,
              summary: withShortCode(replacedBlobPathname ? "Comprobante reemplazado por el pasajero." : "Comprobante subido por el pasajero.", reservation.shortCode),
              changes: diffRecords(beforeUpload, { "payment.status": "PENDING", "payment.receiptFileName": receipt.fileName })
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

    approveManualPayment: (code: string, actor?: AuditActor | null) => reviewReceipt(code, "APPROVED", undefined, undefined, actor),
    rejectManualPayment: (code: string, actor?: AuditActor | null) => reviewReceipt(code, "REJECTED", undefined, undefined, actor),
    reviewDisabilityDocument: (code: string, decision: "APPROVED" | "REJECTED", version: string, actor?: AuditActor | null) =>
      reviewReceipt(code, decision, DISABILITY_DOCUMENT_PROVIDER, version, actor),

    async listAdminSchedules(filters: AdminScheduleFilters = {}): Promise<AdminScheduleRowDto[]> {
      const schedules = (await client.schedule.findMany({
        where: adminScheduleWhere(filters),
        include: scheduleSummaryInclude(),
        orderBy: { departureAt: "asc" }
      })) as unknown as ScheduleSummaryRecord[];

      return schedules.map((schedule) => {
        const option = mapSchedule(schedule);
        return {
          id: schedule.id,
          routeId: schedule.routeId,
          vehicleId: schedule.vehicleId,
          vehicleName: schedule.vehicle.name,
          vehiclePlate: schedule.vehicle.licensePlate ?? null,
          vehicleInternalNumber: schedule.vehicle.internalNumber ?? null,
          extraVehicleNames: (schedule.extraUnits ?? []).map((unit) => unit.vehicle.name),
          route: `${schedule.route.from} -> ${schedule.route.to}`,
          bookingMode: schedule.route.bookingMode,
          stopFares: schedule.route.bookingMode === "SEATED" ? getStopFares(schedule.route) : [],
          priceCents: schedule.route.priceCents,
          currency: schedule.route.currency,
          from: schedule.route.from,
          to: schedule.route.to,
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

    /**
     * Listado del panel, paginado: el `count` se hace con la misma condición que la página y en el
     * cliente sólo entran `pageSize` filas. Si la página pedida quedó fuera de rango (por ejemplo
     * porque un filtro achicó el total) se devuelve la última existente en vez de una tabla vacía.
     */
    async listAdminReservations(filters: AdminReservationFilters = {}, serviceScope?: Prisma.ReservationWhereInput): Promise<AdminReservationsPageDto> {
      // Si se busca un apellido, se resuelve antes sin tildes: ILIKE no las ignora y "perez" no
      // encuentra a "Pérez". Se pide la lista de ids y el where la usa como una alternativa más.
      const passengerIds = filters.q
        ? (
            await client.$queryRaw<Array<{ id: string }>>`
              SELECT id FROM "Passenger"
              WHERE translate(lower("firstName" || ' ' || "lastName" || ' ' || "documentId" || ' ' || email || ' ' || phone), 'áéíóúüñ', 'aeiouun')
                LIKE ${"%" + normalizarBusqueda(filters.q) + "%"}
              LIMIT 500
            `
          ).map((fila) => fila.id)
        : [];
      const filtersWhere = adminReservationWhere(filters, passengerIds);
      const where = serviceScope ? { AND: [filtersWhere, serviceScope] } : filtersWhere;
      const pageSize = adminReservationsPageSize(filters);
      const pedida = adminReservationsPage(filters);
      // Orden por columna desde la URL (issue #192), saneado contra la lista blanca del listado.
      const orderBy = adminReservationOrderBy(filters);

      const pagina = (numero: number) =>
        client.reservation.findMany({
          where,
          include: adminReservationListInclude(),
          orderBy,
          take: pageSize,
          skip: (numero - 1) * pageSize
        });

      let total: number;
      let page: number;
      let totalPages: number;
      let reservations: ReservationRecord[];
      const orden = adminReservationOrder(filters);
      if (orden.columna === "viaje") {
        // Por día y hora del viaje (20-nov): se ordenan los datos mínimos de todas las que cumplen el
        // filtro y se trae completa sólo la página. Con un campo persistido de fecha de viaje esto
        // sería un `orderBy` común (queda anotado en el PR).
        const claves = (await client.reservation.findMany({ where, select: adminTravelOrderSelect() })) as unknown as ClaveDeViaje[];
        const ordenadas = ordenarPorViaje(claves, orden.direccion);
        total = ordenadas.length;
        totalPages = Math.max(1, Math.ceil(total / pageSize));
        page = Math.min(pedida, totalPages);
        const ids = ordenadas.slice((page - 1) * pageSize, page * pageSize).map((clave) => clave.id);
        const filas = ids.length
          ? await client.reservation.findMany({ where: { id: { in: ids } }, include: adminReservationListInclude() })
          : [];
        const posicion = new Map(ids.map((id, indice) => [id, indice]));
        reservations = [...filas].sort((a, b) => (posicion.get(a.id) ?? 0) - (posicion.get(b.id) ?? 0));
      } else {
        // Conteo y página a la vez (antes uno esperaba al otro). Sólo si la página pedida quedó fuera
        // de rango (filtro nuevo, reservas borradas) se vuelve a pedir la última.
        const [cuenta, enPedida] = await Promise.all([client.reservation.count({ where }), pagina(pedida)]);
        total = cuenta;
        totalPages = Math.max(1, Math.ceil(total / pageSize));
        page = Math.min(pedida, totalPages);
        reservations = page === pedida ? enPedida : await pagina(page);
      }

      // Ida y vuelta: el otro tramo de cada reserva enlazada, aunque esté en otra página o en otro día.
      const roundTripIds = [...new Set(reservations.map((reservation) => reservation.roundTripId).filter((id): id is string => Boolean(id)))];
      const companeros = roundTripIds.length
        ? ((await client.reservation.findMany({
            where: { roundTripId: { in: roundTripIds } },
            select: { ...adminTravelOrderSelect(), roundTripId: true }
          })) as unknown as Array<ClaveDeViaje & { roundTripId: string | null }>)
        : [];
      const companeroDe = (reservation: ReservationRecord) => {
        if (!reservation.roundTripId) return null;
        const otro = companeros.find((tramo) => tramo.roundTripId === reservation.roundTripId && tramo.id !== reservation.id);
        if (!otro) return null;
        const propia = claveDeViaje(reservation as unknown as ClaveDeViaje);
        const suya = claveDeViaje(otro);
        return {
          code: otro.code,
          travelDay: suya.slice(0, 10),
          travelTime: horaDelViaje(otro),
          isReturn: suya > propia || (suya === propia && otro.code > reservation.code)
        };
      };

      return {
        items: reservations.map((reservation) => ({
          id: reservation.id,
          code: reservation.code,
          shortCode: reservation.shortCode,
          passenger: `${reservation.passenger.firstName} ${reservation.passenger.lastName}`,
          passengerPhone: reservation.passenger.phone,
          passengerDocumentId: reservation.passenger.documentId,
          creatorLabel: reservationCreatorLabel(reservation),
          route: reservation.schedule
            ? `${reservation.schedule.route.from} -> ${reservation.dropoffStop ?? reservation.schedule.route.to}`
            : reservation.route
              ? `${reservation.route.from} -> ${reservation.route.to}`
              : "Ruta sin datos",
          departureAt: reservation.schedule?.departureAt ?? reservation.airportDetails?.flight?.scheduledAt ?? reservation.airportDetails?.serviceDate ?? reservation.chapelcoDetails?.serviceDate ?? reservation.createdAt,
          travelDay: travelDayKey(
            reservation.chapelcoDetails?.serviceDate,
            reservation.schedule?.departureAt ?? reservation.airportDetails?.flight?.scheduledAt ?? reservation.airportDetails?.serviceDate
          ),
          seatNumber: reservation.seatNumber,
          bookingMode: reservation.bookingMode,
          passengerCount: reservation.passengerCount,
          chapelcoPickupName: reservation.chapelcoDetails?.pickupName ?? null,
          chapelcoAscentSlot: reservation.chapelcoDetails?.ascentSlot ?? null,
          flightNumber: reservation.airportDetails?.flightNumber ?? null,
          status: reservation.status,
          paymentStatus: reservation.payment?.status ?? null,
          paymentProvider: reservation.payment?.provider ?? null,
          totalCents: reservation.totalCents,
          currency: reservation.currency,
          hasReceipt: Boolean(reservation.payment?.receiptBlobPathname),
          receiptFileName: reservation.payment?.receiptFileName ?? null,
          receiptUploadedAt: reservation.payment?.receiptUploadedAt ?? null,
          createdAt: reservation.createdAt,
          travelTime: horaDelViaje(reservation as unknown as ClaveDeViaje),
          roundTripPartner: companeroDe(reservation)
        })),
        total,
        page,
        pageSize,
        totalPages
      };
    },

    /** Cuántas reservas hay con esos filtros: el panel no necesita traerlas para contarlas. */
    async countAdminReservations(filters: AdminReservationFilters = {}): Promise<number> {
      return client.reservation.count({ where: adminReservationWhere(filters) });
    }
  };
}

const defaultRepository = createBookingRepository(prisma as unknown as BookingClient);

export const listPublicRoutes = defaultRepository.listPublicRoutes;
export const listPublicAirportRoutes = defaultRepository.listPublicAirportRoutes;
export const getPublicRouteBySlug = defaultRepository.getPublicRouteBySlug;
export const listSchedulesForRoute = defaultRepository.listSchedulesForRoute;
export const getSeatMap = defaultRepository.getSeatMap;
export const createWebReservation = defaultRepository.createWebReservation;
export const createRouteRoundTripReservation = defaultRepository.createRouteRoundTripReservation;
export const getAdminReservationByCode = defaultRepository.getAdminReservationByCode;
export const getReservationByCode = defaultRepository.getReservationByCode;
export const updatePassengerForReservation = defaultRepository.updatePassengerForReservation;
export const attachManualPaymentReceipt = defaultRepository.attachManualPaymentReceipt;
export const rejectManualPayment = defaultRepository.rejectManualPayment;
export const reviewDisabilityDocument = defaultRepository.reviewDisabilityDocument;
export const approveManualPayment = defaultRepository.approveManualPayment;
export const listAdminSchedules = defaultRepository.listAdminSchedules;
export const listAdminRoutes = defaultRepository.listAdminRoutes;
export const listAdminReservations = defaultRepository.listAdminReservations;
export const countAdminReservations = defaultRepository.countAdminReservations;
