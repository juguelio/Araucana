import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { omitReservationCreator, reservationCreatorData, type ReservationCreationContext } from "@/lib/booking/reservation-creator";
import { fareCounts, reservationTotalCents } from "@/lib/booking/passenger-fares";
import { createReservationCode, createReservationShortCode } from "@/lib/booking/codes";
import { manualPaymentProvider } from "@/lib/payments/manual-provider";
import { BookingError } from "@/lib/booking/repository";
import { prisma } from "@/lib/db/prisma";
import { airportExtrasBreakdown, type AirportExtras } from "./extras";
import { getAirportExtras } from "./extras-settings";
import { airportPickupStart } from "./pickup-start";
import { chargesZoneExtra, type AirportCoverage } from "./pickup-zone";
import { getAirportCoverage } from "./pickup-zone-settings";
import { jetSmartCanonicalNumber } from "./flights";
import type { FlightDirection } from "./provider";
import {
  adminAirportReservationSchema,
  airportReservationSchema,
  airportRoundTripSchema,
  type AdminAirportReservationInput,
  type AirportRoundTripInput,
  type PrivateFlightInput
} from "./validation";

/**
 * Reserva de traslados al aeropuerto: **el pasajero elige un vuelo**, no una salida fija.
 * El aeropuerto no define sus salidas: están supeditadas a los vuelos (demoras, cancelaciones).
 * Los vuelos se leen de la tabla `Flight` (cacheada desde AirLabs), nunca pegándole a la API
 * en cada visita.
 */

/** Capacidad que se asume mientras no hay ninguna combi asignada a ese vuelo. */
export const CAPACIDAD_POR_VUELO = 24;

/**
 * Las combis se asignan según la cantidad de reservas y se pueden cambiar hasta último momento,
 * así que el cupo del vuelo = suma de asientos de las combis asignadas; si no hay ninguna, se
 * asume una combi de referencia para que las reservas puedan entrar.
 */
export function capacidadDeVuelo(combis: Array<{ seats: number }>): number {
  if (combis.length === 0) return CAPACIDAD_POR_VUELO;
  return combis.reduce((total, c) => total + c.seats, 0);
}

/** Cuántas combis conviene tener: una por cada 24 reservas (redondeo hacia arriba). */
export function combisSugeridas(ocupados: number): number {
  return Math.max(1, Math.ceil(ocupados / CAPACIDAD_POR_VUELO));
}
const MAX_INTENTOS = 3;
const TZ_OFFSET_MIN = -180;

export type AirportFlightOption = {
  id: string;
  number: string;
  direction: "ARRIVAL" | "DEPARTURE";
  airline: string | null;
  origin: string;
  scheduledAt: Date;
  estimatedAt: Date | null;
  pickupStartAt: Date | null;
  pickupStartCoordinated: boolean;
  status: string;
  /** "API" = dato real de la aerolínea; "ESTIMADO" = patrón proyectado; "MANUAL" = cargado a mano. */
  source: string;
  occupied: number;
  capacity: number;
  available: number;
  bookable: boolean;
  reason: string | null;
  vehicles: Array<{ id: string; name: string; seats: number; driver: string | null }>;
};

/** Suma de pasajeros vivos de una reserva (las canceladas no ocupan lugar). */
export function pasajerosOcupados(reservas: Array<{ passengerCount: number; status: string }>): number {
  return reservas.filter((r) => r.status !== "CANCELLED").reduce((total, r) => total + r.passengerCount, 0);
}

/**
 * ¿Se puede reservar este vuelo? Devuelve el motivo cuando no.
 *
 * `corteArriboMinutos`: un arribo deja de aceptar reservas ese tiempo antes de aterrizar (según el
 * horario estimado si está demorado), para que la operación llegue a organizar la combi.
 */
export function motivoNoReservable(
  vuelo: {
    status: string;
    scheduledAt: Date;
    estimatedAt?: Date | null;
    source?: string;
    direction?: string;
    pickupStartOverrideAt?: Date | null;
  },
  disponible: number,
  ahora: Date = new Date(),
  corteArriboMinutos = 0,
  corteSalidaMinutos = 0
): string | null {
  if (vuelo.status === "CANCELLED") return "El vuelo está cancelado.";
  if (vuelo.status === "DIVERTED") return "El vuelo fue desviado.";
  // Con demora manda el horario estimado: a la hora programada el avión todavía no llegó (o no
  // salió), así que no se le dice al pasajero que perdió el vuelo antes de que ocurra.
  const referencia = vuelo.estimatedAt && vuelo.estimatedAt > vuelo.scheduledAt ? vuelo.estimatedAt : vuelo.scheduledAt;
  if (referencia <= ahora) {
    // Un horario proyectado no prueba que el vuelo haya pasado: no se afirma eso al pasajero.
    if (vuelo.source === "ESTIMADO") return "Horario estimado ya pasado.";
    // En un arribo el avión ya llegó: decir "ya salió" sería hablar de otro momento del viaje.
    return vuelo.direction === "ARRIVAL" ? "El vuelo ya llegó." : "El vuelo ya salió.";
  }
  if (vuelo.direction === "ARRIVAL" && corteArriboMinutos > 0 && referencia.getTime() - corteArriboMinutos * 60_000 <= ahora.getTime()) {
    return `Las reservas cierran ${corteArriboMinutos} min antes del arribo.`;
  }
  // Salidas (#55): la combi arranca la recorrida 2 h 30 antes del vuelo (o la hora coordinada a
  // mano). Desde ese momento ya no se puede reservar: el pasajero no tendría cómo subirse.
  if (vuelo.direction === "DEPARTURE") {
    const arranqueRecorrida = airportPickupStart({
      direction: "DEPARTURE",
      // Con demora la recorrida se corre con el horario vigente, no con el programado.
      scheduledAt: referencia,
      pickupStartOverrideAt: vuelo.pickupStartOverrideAt ?? null,
      status: vuelo.status
    });
    if (arranqueRecorrida && arranqueRecorrida.getTime() - corteSalidaMinutos * 60_000 <= ahora.getTime()) {
      return corteSalidaMinutos > 0
        ? `Las reservas cierran ${corteSalidaMinutos} min antes de que arranque la recorrida.`
        : "La recorrida ya arrancó.";
    }
  }
  if (disponible <= 0) return "Sin lugares disponibles para ese vuelo.";
  return null;
}

export function rangoDelDia(fecha: string) {
  const desde = new Date(`${fecha}T00:00:00.000-03:00`);
  return { desde, hasta: new Date(desde.getTime() + 24 * 3600 * 1000) };
}

/**
 * Vuelos de un día con su cupo, para el front público y el panel.
 * Sin `direction` devuelve **todos** los del día (arribos y salidas), que es lo que ve el pasajero.
 */
export async function listAirportFlights(input: { date: string; direction?: FlightDirection }): Promise<AirportFlightOption[]> {
  const { desde, hasta } = rangoDelDia(input.date);
  const ahora = new Date();
  const { arrivalCutoffMinutes, departureCutoffMinutes } = await getAirportExtras();

  const vuelos = await prisma.flight.findMany({
    where: { ...(input.direction ? { direction: input.direction } : {}), scheduledAt: { gte: desde, lt: hasta } },
    orderBy: { scheduledAt: "asc" },
    include: {
      reservations: { include: { reservation: { select: { passengerCount: true, status: true } } } },
      assignments: { include: { vehicle: { include: { seats: true } }, driver: { select: { name: true, email: true } } } }
    }
  });

  return vuelos.map((v) => {
    const ocupados = pasajerosOcupados(v.reservations.map((r) => r.reservation));
    const capacidad = capacidadDeVuelo(v.assignments.map((a) => ({ seats: a.vehicle.seats.length })));
    const disponible = Math.max(capacidad - ocupados, 0);
    const motivo = motivoNoReservable(v, disponible, ahora, arrivalCutoffMinutes, departureCutoffMinutes);
    return {
      id: v.id,
      number: v.number,
      direction: v.direction === "DEPARTURE" ? ("DEPARTURE" as const) : ("ARRIVAL" as const),
      airline: v.airline,
      origin: v.origin,
      scheduledAt: v.scheduledAt,
      estimatedAt: v.estimatedAt,
      pickupStartAt: airportPickupStart(v),
      pickupStartCoordinated: Boolean(v.pickupStartOverrideAt),
      status: v.status,
      source: v.source,
      occupied: ocupados,
      capacity: capacidad,
      available: disponible,
      bookable: motivo === null,
      reason: motivo,
      vehicles: v.assignments.map((a) => ({
        id: a.id,
        name: a.vehicle.name,
        seats: a.vehicle.seats.length,
        driver: a.driver?.name ?? a.driver?.email ?? null
      }))
    };
  });
}

/** Número de vuelo comparable: "LV-BET ", "ar 1656" → "LVBET", "AR1656". */
export function claveDeVuelo(numero: string): string {
  return jetSmartCanonicalNumber(numero) ?? numero.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Un vuelo privado se carga con día + hora local argentina: "2026-11-05" + "14:30". */
export function horarioLocal(fecha: string, hora: string): Date {
  return new Date(`${fecha}T${hora.length === 5 ? `${hora}:00` : hora}.000-03:00`);
}

/** ¿Ese instante cae en el día argentino `aaaa-mm-dd`? */
export function esDelDia(fecha: string, instante: Date): boolean {
  const { desde, hasta } = rangoDelDia(fecha);
  return instante >= desde && instante < hasta;
}

/**
 * Entre los vuelos ya cargados con la misma clave elige el de horario más parecido. Así los pasajeros
 * del **mismo** charter comparten un solo vuelo (y su cupo) en vez de duplicarlo con cada reserva.
 */
export function elegirVueloExistente<T extends { number: string; scheduledAt: Date }>(
  candidatos: T[],
  numero: string,
  hora: Date
): T | null {
  const buscada = claveDeVuelo(numero);
  const mismos = candidatos.filter((c) => claveDeVuelo(c.number) === buscada);
  if (mismos.length === 0) return null;
  return mismos.reduce((mejor, actual) =>
    Math.abs(actual.scheduledAt.getTime() - hora.getTime()) < Math.abs(mejor.scheduledAt.getTime() - hora.getTime())
      ? actual
      : mejor
  );
}

/** Nombre para mostrar cuando el pasajero no cargó el origen/destino del vuelo privado. */
export const ORIGEN_PRIVADO_DESCONOCIDO = "Vuelo privado";
type Tx = Prisma.TransactionClient;

/** Un tramo tal como llega del formulario: vuelo de un sentido + su pickup. */
type TramoSolicitado = {
  flightNumber: string;
  direction: FlightDirection;
  serviceDate: string;
  privateFlight?: PrivateFlightInput;
  pickupName?: string | null;
  pickupAddress?: string | null;
  pickupPoint?: [number, number];
  pickupNotes?: string | null;
};

/** La ruta del slug tiene que existir, estar activa y ser de aeropuerto. */
async function rutaDelSlug(routeSlug: string) {
  const route = await prisma.travelRoute.findUnique({ where: { slug: routeSlug } });
  if (!route || !route.isActive || route.bookingMode !== "AIRPORT") {
    throw new BookingError("ROUTE_NOT_FOUND", "Route not available for airport bookings");
  }
  return route;
}

/**
 * Busca (o crea, si es un vuelo privado) el vuelo de un tramo dentro de la transacción y valida
 * que se pueda reservar: día correcto, horario futuro, no cancelado y con cupo.
 */
function validarVueloPrivado(tramo: TramoSolicitado) {
  // El vuelo privado se valida antes de tocar la base: tiene que caer en el día que se reserva y
  // no puede estar en el pasado (nadie reserva un traslado para un avión que ya aterrizó).
  const privado = tramo.privateFlight;
  if (!privado) return;

  const horario = new Date(privado.scheduledAt);
  if (!esDelDia(tramo.serviceDate, horario)) {
    throw new BookingError("PRIVATE_FLIGHT_INVALID", "El vuelo privado tiene que ser del mismo día que estás reservando.");
  }
  if (horario <= new Date()) {
    throw new BookingError("FLIGHT_IN_PAST", "El horario del vuelo ya pasó. Revisá la hora del vuelo privado.");
  }
}

async function buscarVueloDelTramo(
  tx: Tx,
  tramo: TramoSolicitado,
  corteArriboMinutos = 0,
  corteSalidaMinutos = 0
) {
  const { desde, hasta } = rangoDelDia(tramo.serviceDate);
  const numero = claveDeVuelo(tramo.flightNumber);
  const privado = tramo.privateFlight;
  validarVueloPrivado(tramo);

  const incluirCupo = {
    reservations: { include: { reservation: { select: { passengerCount: true, status: true } } } },
    assignments: { include: { vehicle: { include: { seats: true } } } }
  };
  const candidatos = await tx.flight.findMany({
    where: {
      scheduledAt: { gte: desde, lt: hasta },
      ...(privado ? { direction: tramo.direction } : {}),
      OR: [
        { number: tramo.flightNumber.trim() },
        { number: tramo.flightNumber.trim().toUpperCase() },
        ...(jetSmartCanonicalNumber(tramo.flightNumber) ? [{ number: numero }] : [])
      ]
    },
    include: incluirCupo
  });
  let vuelo = candidatos.find((v) => claveDeVuelo(v.number) === numero) ?? null;

  // Vuelo privado (charter, avión particular): si otro pasajero del mismo avión ya lo cargó
  // ese día se reutiliza su vuelo —y su cupo—; si no, se crea marcado como cargado por el
  // pasajero para que la operación lo revise.
  if (!vuelo && privado) {
    const horario = new Date(privado.scheduledAt);
    const canonico = jetSmartCanonicalNumber(privado.number);
    const delMismoSentido = await tx.flight.findMany({
      where: { scheduledAt: { gte: desde, lt: hasta }, direction: tramo.direction },
      include: incluirCupo
    });
    vuelo =
      elegirVueloExistente(delMismoSentido, privado.number, horario) ??
      (await tx.flight.create({
        data: {
          number: canonico ?? privado.number.trim().toUpperCase(),
          airline: canonico ? "JA" : privado.airline?.trim() || null,
          origin: privado.origin?.trim() || ORIGEN_PRIVADO_DESCONOCIDO,
          direction: tramo.direction,
          scheduledAt: horario,
          status: "SCHEDULED",
          source: "PASAJERO",
          notes: "Vuelo privado cargado por el pasajero al reservar.",
          createdBy: "pasajero"
        },
        include: incluirCupo
      }));
  }
  if (!vuelo) throw new BookingError("FLIGHT_NOT_FOUND", "Flight not found for that date");

  const ocupados = pasajerosOcupados(vuelo.reservations.map((r) => r.reservation));
  const capacidad = capacidadDeVuelo(vuelo.assignments.map((a) => ({ seats: a.vehicle.seats.length })));
  const disponible = Math.max(capacidad - ocupados, 0);
  const motivo = motivoNoReservable(vuelo, disponible, new Date(), corteArriboMinutos, corteSalidaMinutos);
  if (motivo) {
    throw new BookingError(motivo.includes("lugares") ? "CAPACITY_FULL" : "SCHEDULE_CLOSED", motivo);
  }

  return { vuelo, desde, disponible };
}

/** Reglas de precio del viaje: cobertura (recargo de zona) y extras vigentes. */
type ReglasDeExtras = {
  coverage: AirportCoverage;
  extras: AirportExtras;
  sportsLuggageCount?: number;
};

type CrearTramoParams = {
  tramo: TramoSolicitado;
  passengerId: string;
  passengerCount: number;
  halfFareCount: number;
  freeFareCount: number;
  overrideTotalCents?: number;
  /** Extras del aeropuerto: se cobran por tramo (el recargo de zona, según el pickup de ese tramo). */
  reglas: ReglasDeExtras;
  /** Las dos reservas de un ida y vuelta comparten este id; un tramo suelto va sin él. */
  roundTripId?: string;
  creator?: ReservationCreationContext["creator"];
};

/** Crea UNA reserva atada a su vuelo, con el pago pendiente, dentro de la transacción del llamador. */
async function crearTramo(tx: Tx, params: CrearTramoParams) {
  const { tramo, passengerId, passengerCount, halfFareCount, freeFareCount } = params;
  const { vuelo, desde, disponible } = await buscarVueloDelTramo(
    tx,
    tramo,
    params.reglas.extras.arrivalCutoffMinutes,
    params.reglas.extras.departureCutoffMinutes
  );
  // El recargo de zona lo decide el servidor con el punto marcado: no se toma del cliente.
  const adicionales = airportExtrasBreakdown(
    { zoneExtra: chargesZoneExtra(tramo.pickupPoint ?? null, params.reglas.coverage), sportsLuggageCount: params.reglas.sportsLuggageCount },
    params.reglas.extras
  );

  if (passengerCount > disponible) {
    throw new BookingError("CAPACITY_FULL", "No hay suficientes lugares en ese vuelo");
  }

  // La ruta canónica del sentido real del vuelo manda para todo: `routeId`, tarifa y moneda
  // tienen que salir de la misma ruta. Antes el ID salía de acá y el precio de la ruta del
  // slug, así que una reserva podía quedar con la tarifa del otro sentido.
  const rutaDelSentido = await tx.travelRoute.findFirst({
    where: { bookingMode: "AIRPORT", specialType: vuelo.direction, isActive: true },
    orderBy: { createdAt: "asc" }
  });
  if (!rutaDelSentido) {
    throw new BookingError("ROUTE_NOT_FOUND", "No hay tarifa activa para ese sentido del traslado al aeropuerto.");
  }

  const fares = fareCounts(passengerCount, halfFareCount, freeFareCount);
  const reservation = await tx.reservation.create({
    data: {
      code: createReservationCode(),
      shortCode: createReservationShortCode(),
      roundTripId: params.roundTripId ?? null,
      ...reservationCreatorData(params.creator),
      routeId: rutaDelSentido.id,
      passengerId,
      passengerCount,
      bookingMode: "AIRPORT",
      status: "PENDING_PAYMENT",
      totalCents: params.overrideTotalCents ?? reservationTotalCents(rutaDelSentido.priceCents, fareCounts(passengerCount, halfFareCount, freeFareCount)) + adicionales.totalCents,
      halfFareCount: fares.half,
      freeFareCount: fares.free,
      currency: rutaDelSentido.currency,
      airportDetails: {
        create: {
          halfFareCount,
          flightNumber: vuelo.number,
          flightId: vuelo.id,
          direction: vuelo.direction,
          serviceDate: desde,
          pickupName: tramo.pickupName ?? null,
          pickupAddress: tramo.pickupAddress ?? null,
          pickupLatitude: tramo.pickupPoint?.[0] ?? null,
          pickupLongitude: tramo.pickupPoint?.[1] ?? null,
          pickupNotes: tramo.pickupNotes ?? null,
          sportsLuggageCount: adicionales.sportsLuggageCount,
          sportsLuggageUnitCents: adicionales.sportsLuggageUnitCents,
          zoneExtraCents: adicionales.zoneExtraCents
        }
      }
    },
    omit: omitReservationCreator,
    include: { route: true, passenger: true, airportDetails: true }
  });

  // Igual que las reservas comunes: se crea el pago pendiente (transferencia/manual) para que
  // el pasajero pueda subir el comprobante desde su link y la reserva quede a confirmar.
  const pago = await manualPaymentProvider.createPendingPayment({
    reservationCode: reservation.code,
    amountCents: reservation.totalCents,
    currency: reservation.currency
  });
  await tx.payment.create({
    data: {
      reservationId: reservation.id,
      provider: pago.provider,
      status: pago.status,
      amountCents: pago.amountCents,
      currency: pago.currency,
      externalRef: pago.externalRef
    }
  });

  return reservation;
}

/** ¿El error es de los que se resuelven reintentando la transacción entera? */
function esReintentable(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
  // P2034: dos reservas compitieron por el mismo cupo. P2002: dos pasajeros del mismo charter
  // crearon el vuelo privado al mismo tiempo (al reintentar, el segundo lo encuentra creado).
  return code === "P2034" || code === "P2002";
}

/** Reglas vigentes (cobertura de la zona y extras configurados) para toda una reserva. */
async function reglasDeExtras(sportsLuggageCount?: number): Promise<ReglasDeExtras> {
  const [coverage, extras] = await Promise.all([getAirportCoverage(), getAirportExtras()]);
  return { coverage, extras, sportsLuggageCount };
}

/** Crea la reserva atada al vuelo, con control de cupo dentro de la misma transacción. */
export async function createAirportReservation(input: AdminAirportReservationInput, { fromAdmin, creator }: ReservationCreationContext = {}) {
  const parsed: AdminAirportReservationInput = (fromAdmin ? adminAirportReservationSchema : airportReservationSchema).parse(input);
  await rutaDelSlug(parsed.routeSlug);
  validarVueloPrivado({
    flightNumber: parsed.flightNumber,
    direction: parsed.direction,
    serviceDate: parsed.serviceDate,
    privateFlight: parsed.privateFlight
  });
  const reglas = await reglasDeExtras(parsed.sportsLuggageCount);

  for (let intento = 1; intento <= MAX_INTENTOS; intento += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const passenger = await tx.passenger.create({ data: parsed.passenger });
        return crearTramo(tx, {
          tramo: {
            flightNumber: parsed.flightNumber,
            direction: parsed.direction,
            serviceDate: parsed.serviceDate,
            privateFlight: parsed.privateFlight,
            pickupName: parsed.pickupName ?? null,
            pickupAddress: parsed.pickupAddress ?? null,
            pickupPoint: parsed.pickupPoint,
            pickupNotes: parsed.pickupNotes ?? null
          },
          passengerId: passenger.id,
          passengerCount: parsed.passengerCount,
          halfFareCount: parsed.halfFareCount ?? 0,
          freeFareCount: parsed.freeFareCount ?? 0,
          overrideTotalCents: parsed.overrideTotalCents,
          reglas,
          creator
        });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (esReintentable(error)) {
        if (intento < MAX_INTENTOS) continue;
        throw new BookingError("BOOKING_BUSY", "El vuelo está recibiendo otras reservas. Intentalo nuevamente.");
      }
      throw error;
    }
  }

  throw new BookingError("BOOKING_BUSY", "No pudimos crear la reserva. Intenta nuevamente.");
}

/**
 * Ida y vuelta (#36): **una sola transacción** crea los dos tramos con los datos del pasajero
 * cargados una vez (un solo `Passenger`, dos `Reservation` con el mismo `roundTripId`) y un pago
 * pendiente por tramo. Cada tramo se paga y se cancela por separado.
 *
 * Los extras (equipaje deportivo y recargo de zona) se cobran **por tramo**: el recargo depende del
 * punto de pickup de ese tramo y el equipaje viaja en los dos.
 */
export async function createAirportRoundTripReservation(input: AirportRoundTripInput, { creator }: ReservationCreationContext = {}) {
  const parsed = airportRoundTripSchema.parse(input);
  await rutaDelSlug(parsed.routeSlug);
  validarVueloPrivado({ ...parsed.arrival, direction: "ARRIVAL" });
  validarVueloPrivado({ ...parsed.departure, direction: "DEPARTURE" });
  const reglas = await reglasDeExtras(parsed.sportsLuggageCount);
  const roundTripId = randomUUID();
  const passengerCount = parsed.passengerCount;
  const halfFareCount = parsed.halfFareCount ?? 0;
  const freeFareCount = parsed.freeFareCount ?? 0;

  for (let intento = 1; intento <= MAX_INTENTOS; intento += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const passenger = await tx.passenger.create({ data: parsed.passenger });
        const base = { passengerId: passenger.id, passengerCount, halfFareCount, freeFareCount, roundTripId, reglas, creator };
        // La llegada va primero: si el cupo de la vuelta falla, no queda media reserva creada.
        const arrival = await crearTramo(tx, {
          ...base,
          tramo: {
            flightNumber: parsed.arrival.flightNumber,
            direction: "ARRIVAL",
            serviceDate: parsed.arrival.serviceDate,
            privateFlight: parsed.arrival.privateFlight,
            pickupName: parsed.arrival.pickupName ?? null,
            pickupAddress: parsed.arrival.pickupAddress ?? null,
            pickupPoint: parsed.arrival.pickupPoint,
            pickupNotes: parsed.arrival.pickupNotes ?? null
          }
        });
        const departure = await crearTramo(tx, {
          ...base,
          tramo: {
            flightNumber: parsed.departure.flightNumber,
            direction: "DEPARTURE",
            serviceDate: parsed.departure.serviceDate,
            privateFlight: parsed.departure.privateFlight,
            pickupName: parsed.departure.pickupName ?? null,
            pickupAddress: parsed.departure.pickupAddress ?? null,
            pickupPoint: parsed.departure.pickupPoint,
            pickupNotes: parsed.departure.pickupNotes ?? null
          }
        });

        return { roundTripId, arrival, departure };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (esReintentable(error)) {
        if (intento < MAX_INTENTOS) continue;
        throw new BookingError("BOOKING_BUSY", "El vuelo está recibiendo otras reservas. Intentalo nuevamente.");
      }
      throw error;
    }
  }

  throw new BookingError("BOOKING_BUSY", "No pudimos crear la reserva. Intenta nuevamente.");
}
