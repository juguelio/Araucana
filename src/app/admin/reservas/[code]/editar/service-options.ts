import { prisma } from "@/lib/db/prisma";
import { chapelcoAscentSlots } from "@/lib/chapelco/constants";
import { scheduleSeatCount, extraUnitsCountInclude } from "@/lib/booking/schedule-units";
import type { ReservationDetailDto as ReservationDto } from "@/lib/booking/types";

/**
 * Opciones para pasar una reserva a otro servicio desde «Editar reserva». Lo que se ofrece es una
 * ayuda: el servidor vuelve a medir el cupo y el horario al guardar.
 */

export type SalidaOption = {
  id: string;
  routeId: string;
  /** «San Martín → Bariloche · 24/11 08:00 · 12 libres». */
  label: string;
  priceCents: number;
  free: number;
};

export type ServiceMove =
  | { mode: "SEATED"; currentScheduleId: string; currentRouteId: string; options: SalidaOption[] }
  | {
      mode: "AIRPORT";
      routeSlug: string;
      isPrivate?: boolean;
      currentFlightId: string | null;
      currentLabel: string;
      currentDate: string;
      currentDirection: string;
      /** Tarifa por persona de cada sentido: cambiar a un vuelo del otro sentido usa la otra. */
      prices: Record<"ARRIVAL" | "DEPARTURE", number | null>;
    }
  | { mode: "CHAPELCO"; serviceDate: string; ascentSlot: string; slots: readonly string[] };

const DIAS_HACIA_ADELANTE = 120;

const fechaHora = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
});

const diaArgentina = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });

async function salidasAbiertas(reservation: ReservationDto): Promise<SalidaOption[]> {
  const ahora = new Date();
  const hasta = new Date(ahora.getTime() + DIAS_HACIA_ADELANTE * 24 * 3600 * 1000);
  const salidas = await prisma.schedule.findMany({
    where: {
      departureAt: { gt: ahora, lt: hasta },
      status: { in: ["OPEN", "DOCUMENTATION"] },
      route: { bookingMode: "SEATED", isActive: true },
      vehicle: { isActive: true }
    },
    orderBy: { departureAt: "asc" },
    take: 400,
    include: {
      route: { select: { id: true, from: true, to: true, priceCents: true } },
      vehicle: { select: { id: true, isActive: true, name: true, _count: { select: { seats: true } } } },
      extraUnits: extraUnitsCountInclude,
      reservations: { where: { status: { not: "CANCELLED" } }, select: { id: true, passengerCount: true } }
    }
  });
  return salidas.map((salida) => {
    const ocupados = salida.reservations
      .filter((item) => item.id !== reservation.id)
      .reduce((total, item) => total + item.passengerCount, 0);
    const free = Math.max(scheduleSeatCount(salida) - ocupados, 0);
    return {
      id: salida.id,
      routeId: salida.route.id,
      label: `${salida.route.from} → ${salida.route.to} · ${fechaHora.format(salida.departureAt)} · ${free} ${free === 1 ? "libre" : "libres"}`,
      priceCents: salida.route.priceCents,
      free
    };
  });
}

/** `null` cuando la reserva no admite cambio de servicio (cancelada: primero se restituye). */
export async function serviceMoveFor(reservation: ReservationDto): Promise<ServiceMove | null> {
  if (reservation.status === "CANCELLED") return null;
  if (reservation.bookingMode === "SEATED" && reservation.schedule?.id) {
    return {
      mode: "SEATED",
      currentScheduleId: reservation.schedule.id,
      currentRouteId: reservation.route.id,
      options: await salidasAbiertas(reservation)
    };
  }
  if (reservation.bookingMode === "AIRPORT" && reservation.airportDetails) {
    const detalles = reservation.airportDetails;
    const rutas = await prisma.travelRoute.findMany({
      where: { bookingMode: "AIRPORT", isActive: true, specialType: { in: ["ARRIVAL", "DEPARTURE"] } },
      orderBy: { createdAt: "asc" },
      select: { specialType: true, priceCents: true }
    });
    const precio = (sentido: string) => rutas.find((ruta) => ruta.specialType === sentido)?.priceCents ?? null;
    const horario = detalles.flight?.scheduledAt ?? detalles.serviceDate;
    return {
      mode: "AIRPORT",
      routeSlug: reservation.route.slug,
      isPrivate: detalles.isPrivate,
      currentFlightId: detalles.flightId ?? null,
      currentLabel: `${detalles.direction === "ARRIVAL" ? "Arribo" : "Salida"} ${detalles.flightNumber} · ${fechaHora.format(horario)}`,
      currentDate: diaArgentina.format(horario),
      currentDirection: detalles.direction,
      prices: { ARRIVAL: precio("ARRIVAL"), DEPARTURE: precio("DEPARTURE") }
    };
  }
  if (reservation.bookingMode === "CHAPELCO" && reservation.chapelcoDetails) {
    return {
      mode: "CHAPELCO",
      // Chapelco guarda el día a medianoche UTC.
      serviceDate: reservation.chapelcoDetails.serviceDate.toISOString().slice(0, 10),
      ascentSlot: reservation.chapelcoDetails.ascentSlot,
      slots: chapelcoAscentSlots
    };
  }
  return null;
}
