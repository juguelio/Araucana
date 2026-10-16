import { createReservationCode } from "@/lib/booking/codes";
import { BookingError } from "@/lib/booking/repository";
import { prisma } from "@/lib/db/prisma";
import type { FlightDirection } from "./provider";
import { airportReservationSchema, type AirportReservationInput } from "./validation";

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
  vuelo: { status: string; scheduledAt: Date },
  disponible: number,
  ahora: Date = new Date()
): string | null {
  if (vuelo.status === "CANCELLED") return "El vuelo está cancelado.";
  if (vuelo.status === "DIVERTED") return "El vuelo fue desviado.";
  if (vuelo.scheduledAt <= ahora) return "El vuelo ya salió.";
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

const clave = (n: string) => n.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Crea la reserva atada al vuelo, con control de cupo dentro de la misma transacción. */
export async function createAirportReservation(input: AirportReservationInput) {
  const parsed = airportReservationSchema.parse(input);

  const route = await prisma.travelRoute.findUnique({ where: { slug: parsed.routeSlug } });
  if (!route || !route.isActive || route.bookingMode !== "AIRPORT") {
    throw new BookingError("ROUTE_NOT_FOUND", "Route not available for airport bookings");
  }

  const { desde, hasta } = rangoDelDia(parsed.serviceDate);
  const numero = clave(parsed.flightNumber);

  for (let intento = 1; intento <= MAX_INTENTOS; intento += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // El vuelo manda: se busca el número en las dos direcciones del día y la reserva toma
        // la dirección del vuelo elegido (no la de la página desde la que se reservó).
        const candidatos = await tx.flight.findMany({
          where: {
            scheduledAt: { gte: desde, lt: hasta },
            OR: [{ number: parsed.flightNumber.trim() }, { number: parsed.flightNumber.trim().toUpperCase() }]
          },
          include: {
            reservations: { include: { reservation: { select: { passengerCount: true, status: true } } } },
            assignments: { include: { vehicle: { include: { seats: true } } } }
          }
        });
        const vuelo = candidatos.find((v) => clave(v.number) === numero);
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

        // La ruta que corresponde a la dirección real del vuelo (así la confirmación muestra el sentido correcto).
        const rutaDelSentido = await tx.travelRoute.findFirst({
          where: { bookingMode: "AIRPORT", specialType: vuelo.direction, isActive: true }
        });

        const passenger = await tx.passenger.create({ data: parsed.passenger });
        const reservation = await tx.reservation.create({
          data: {
            code: createReservationCode(),
            routeId: (rutaDelSentido ?? route).id,
            passengerId: passenger.id,
            passengerCount: parsed.passengerCount,
            bookingMode: "AIRPORT",
            status: "PENDING_PAYMENT",
            totalCents: route.priceCents * parsed.passengerCount,
            currency: route.currency,
            airportDetails: {
              create: {
                flightNumber: vuelo.number,
                flightId: vuelo.id,
                direction: vuelo.direction,
                serviceDate: desde,
                pickupName: parsed.pickupName ?? null,
                pickupAddress: parsed.pickupAddress ?? null,
                pickupNotes: parsed.pickupNotes ?? null
              }
            }
          },
          include: { route: true, passenger: true, airportDetails: true }
        });

        return reservation;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2034") {
        if (intento < MAX_INTENTOS) continue;
        throw new BookingError("BOOKING_BUSY", "El vuelo está recibiendo otras reservas. Intentalo nuevamente.");
      }
      throw error;
    }
  }

  throw new BookingError("BOOKING_BUSY", "No pudimos crear la reserva. Intenta nuevamente.");
}
