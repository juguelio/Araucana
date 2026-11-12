import { omitReservationCreator, reservationCreatorData, type ReservationCreationContext } from "@/lib/booking/reservation-creator";
import { fareCounts, reservationTotalCents } from "@/lib/booking/passenger-fares";
import { createReservationCode } from "@/lib/booking/codes";
import { manualPaymentProvider } from "@/lib/payments/manual-provider";
import { BookingError } from "@/lib/booking/repository";
import { prisma } from "@/lib/db/prisma";
import { airportPickupStart } from "./pickup-start";
import { jetSmartCanonicalNumber } from "./flights";
import type { FlightDirection } from "./provider";
import { adminAirportReservationSchema, airportReservationSchema, type AdminAirportReservationInput } from "./validation";

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

/** ¿Se puede reservar este vuelo? Devuelve el motivo cuando no. */
export function motivoNoReservable(
  vuelo: { status: string; scheduledAt: Date; estimatedAt?: Date | null; source?: string; direction?: string },
  disponible: number,
  ahora: Date = new Date()
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
    const motivo = motivoNoReservable(v, disponible, ahora);
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

/** Crea la reserva atada al vuelo, con control de cupo dentro de la misma transacción. */
export async function createAirportReservation(input: AdminAirportReservationInput, { fromAdmin, creator }: ReservationCreationContext = {}) {
  const parsed: AdminAirportReservationInput = (fromAdmin ? adminAirportReservationSchema : airportReservationSchema).parse(input);

  const route = await prisma.travelRoute.findUnique({ where: { slug: parsed.routeSlug } });
  if (!route || !route.isActive || route.bookingMode !== "AIRPORT") {
    throw new BookingError("ROUTE_NOT_FOUND", "Route not available for airport bookings");
  }

  const { desde, hasta } = rangoDelDia(parsed.serviceDate);
  const numero = claveDeVuelo(parsed.flightNumber);
  const privado = parsed.privateFlight;

  // El vuelo privado se valida antes de tocar la base: tiene que caer en el día que se reserva y
  // no puede estar en el pasado (nadie reserva un traslado para un avión que ya aterrizó).
  if (privado) {
    const horario = new Date(privado.scheduledAt);
    if (!esDelDia(parsed.serviceDate, horario)) {
      throw new BookingError("PRIVATE_FLIGHT_INVALID", "El vuelo privado tiene que ser del mismo día que estás reservando.");
    }
    if (horario <= new Date()) {
      throw new BookingError("FLIGHT_IN_PAST", "El horario del vuelo ya pasó. Revisá la hora del vuelo privado.");
    }
  }

  for (let intento = 1; intento <= MAX_INTENTOS; intento += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // El vuelo manda: se busca el número en las dos direcciones del día y la reserva toma
        // la dirección del vuelo elegido (no la de la página desde la que se reservó).
        const incluirCupo = {
          reservations: { include: { reservation: { select: { passengerCount: true, status: true } } } },
          assignments: { include: { vehicle: { include: { seats: true } } } }
        };
        const candidatos = await tx.flight.findMany({
          where: {
            scheduledAt: { gte: desde, lt: hasta },
            ...(privado ? { direction: parsed.direction } : {}),
            OR: [
              { number: parsed.flightNumber.trim() },
              { number: parsed.flightNumber.trim().toUpperCase() },
              ...(jetSmartCanonicalNumber(parsed.flightNumber) ? [{ number: numero }] : [])
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
            where: { scheduledAt: { gte: desde, lt: hasta }, direction: parsed.direction },
            include: incluirCupo
          });
          vuelo =
            elegirVueloExistente(delMismoSentido, privado.number, horario) ??
            (await tx.flight.create({
              data: {
                number: canonico ?? privado.number.trim().toUpperCase(),
                airline: canonico ? "JA" : privado.airline?.trim() || null,
                origin: privado.origin?.trim() || ORIGEN_PRIVADO_DESCONOCIDO,
                direction: parsed.direction,
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
        const motivo = motivoNoReservable(vuelo, disponible);
        if (motivo) {
          throw new BookingError(motivo.includes("lugares") ? "CAPACITY_FULL" : "SCHEDULE_CLOSED", motivo);
        }
        if (parsed.passengerCount > disponible) {
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

        const fares = fareCounts(parsed.passengerCount, parsed.halfFareCount ?? 0, parsed.freeFareCount ?? 0);
        const passenger = await tx.passenger.create({ data: parsed.passenger });
        const reservation = await tx.reservation.create({
          data: {
            code: createReservationCode(),
            ...reservationCreatorData(creator),
            routeId: rutaDelSentido.id,
            passengerId: passenger.id,
            passengerCount: parsed.passengerCount,
            bookingMode: "AIRPORT",
            status: "PENDING_PAYMENT",
            totalCents: parsed.overrideTotalCents ?? reservationTotalCents(rutaDelSentido.priceCents, fareCounts(parsed.passengerCount, parsed.halfFareCount ?? 0, parsed.freeFareCount ?? 0)),
            halfFareCount: fares.half,
            freeFareCount: fares.free,
            currency: rutaDelSentido.currency,
            airportDetails: {
              create: {
                halfFareCount: parsed.halfFareCount ?? 0,
                flightNumber: vuelo.number,
                flightId: vuelo.id,
                direction: vuelo.direction,
                serviceDate: desde,
                pickupName: parsed.pickupName ?? null,
                pickupAddress: parsed.pickupAddress ?? null,
                pickupLatitude: parsed.pickupPoint?.[0] ?? null,
                pickupLongitude: parsed.pickupPoint?.[1] ?? null,
                pickupNotes: parsed.pickupNotes ?? null
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
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
      // P2034: dos reservas compitieron por el mismo cupo. P2002: dos pasajeros del mismo charter
      // crearon el vuelo privado al mismo tiempo (al reintentar, el segundo lo encuentra creado).
      if (code === "P2034" || code === "P2002") {
        if (intento < MAX_INTENTOS) continue;
        throw new BookingError("BOOKING_BUSY", "El vuelo está recibiendo otras reservas. Intentalo nuevamente.");
      }
      throw error;
    }
  }

  throw new BookingError("BOOKING_BUSY", "No pudimos crear la reserva. Intenta nuevamente.");
}
