/**
 * Lugar en un servicio para una reserva que ya existe: la restitución de una cancelada (#117) y el
 * cambio de salida, vuelo o fecha desde «Editar reserva» exigen lo mismo que un alta —servicio
 * futuro, abierto y con cupo—. La reserva misma no cuenta como ocupada (`excluir`).
 *
 * Cada función recibe el cliente de la transacción del llamador y tira `BookingError` con un
 * mensaje que termina en `quedan N lugares y la reserva {ocupa|quedaría con} M`.
 */
import { getAirportExtras } from "@/lib/airport/extras-settings";
import { motivoNoReservable } from "@/lib/airport/booking";
import { incluirCupoDelVuelo, leerCupoDeRecorrida } from "@/lib/airport/recorrida-capacity";
import { chapelcoActiveReservationStatuses } from "@/lib/chapelco/constants";
import type { Prisma } from "@prisma/client";
import { BookingError, firstAvailableSeat } from "./repository";
import { esFranjaDeChapelco, hayLugar, lugaresLibres, personasQueBloqueanLaFranja, servicioYaPaso, vueloYaPaso } from "./restore";
import { extraUnitsSeatsInclude, scheduleSeatPool } from "./schedule-units";

type Tx = Prisma.TransactionClient;

type Pedido = {
  /** La reserva que se mueve o se restituye: no ocupa lugar contra sí misma. */
  excluir: string;
  pasajeros: number;
  ahora: Date;
  /** Cómo cierra el mensaje de cupo: «la reserva ocupa 3» (restituir) o «quedaría con 3» (mover). */
  frase: (pasajeros: number) => string;
  /** Qué se está haciendo, para los mensajes: «restituir la reserva», «pasar la reserva a esa salida». */
  accion: string;
};

/** Salida de ruta abierta y futura con lugar; devuelve el primer asiento libre. */
export async function lugarEnSalida(tx: Tx, scheduleId: string, pedido: Pedido) {
  const schedule = await tx.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      route: { select: { isActive: true, bookingMode: true } },
      vehicle: { select: { isActive: true, seats: true } },
      extraUnits: extraUnitsSeatsInclude,
      reservations: { select: { id: true, status: true, passengerCount: true, seatId: true, seatNumber: true } }
    }
  });
  if (!schedule) throw new BookingError("SCHEDULE_NOT_FOUND", "La salida ya no existe.");
  if (!["OPEN", "DOCUMENTATION"].includes(schedule.status) || schedule.departureAt <= pedido.ahora || !schedule.route.isActive || !schedule.vehicle || schedule.vehicle.isActive === false) {
    throw new BookingError("SERVICE_ALREADY_STARTED", `La salida ya arrancó o se cerró: no se puede ${pedido.accion}.`);
  }
  const vivas = schedule.reservations.filter((item) => item.id !== pedido.excluir && item.status !== "CANCELLED");
  const ocupados = vivas.reduce((total, item) => total + item.passengerCount, 0);
  const asientos = scheduleSeatPool(schedule);
  if (!hayLugar(asientos.length, ocupados, pedido.pasajeros)) {
    throw new BookingError(
      "CAPACITY_FULL",
      `No hay lugar en esa salida: quedan ${lugaresLibres(asientos.length, ocupados)} lugares y ${pedido.frase(pedido.pasajeros)}.`
    );
  }
  const seat = firstAvailableSeat(asientos, new Set(vivas.map((item) => item.seatId)), new Set(vivas.map((item) => item.seatNumber)));
  return { schedule, seatId: seat?.id ?? null, seatNumber: seat?.number ?? null };
}

/** Vuelo no cancelado, todavía reservable y con lugar en las naves asignadas. */
export async function lugarEnVuelo(tx: Tx, flightId: string, pedido: Pedido, privada = false) {
  const vuelo = await tx.flight.findUnique({
    where: { id: flightId },
    include: incluirCupoDelVuelo
  });
  if (!vuelo) throw new BookingError("FLIGHT_NOT_FOUND", "El vuelo ya no existe.");
  if (vuelo.status === "CANCELLED" || vuelo.status === "DIVERTED") {
    throw new BookingError("FLIGHT_NOT_BOOKABLE", `El vuelo está cancelado o desviado: no se puede ${pedido.accion}.`);
  }
  if (vueloYaPaso(vuelo, pedido.ahora)) {
    throw new BookingError(
      "SERVICE_ALREADY_STARTED",
      vuelo.direction === "ARRIVAL" ? `El vuelo ya llegó: no se puede ${pedido.accion}.` : `El vuelo ya salió: no se puede ${pedido.accion}.`
    );
  }
  const extras = await getAirportExtras(tx);
  const cerrado = motivoNoReservable(vuelo, 1, pedido.ahora, extras.arrivalCutoffMinutes, extras.departureCutoffMinutes);
  if (cerrado) throw new BookingError("SERVICE_ALREADY_STARTED", cerrado);
  if (!privada) {
    const { capacidad, ocupados, disponibles } = await leerCupoDeRecorrida(tx, vuelo, pedido.excluir);
    if (!hayLugar(capacidad, ocupados, pedido.pasajeros)) {
      throw new BookingError(
        "CAPACITY_FULL",
        `No hay lugar en ese vuelo: quedan ${disponibles} lugares y ${pedido.frase(pedido.pasajeros)}.`
      );
    }
  }
  return vuelo;
}

/** Día de Chapelco futuro y, si la franja tiene cupo, lugar en la flota activa. */
export async function lugarEnChapelco(
  tx: Tx,
  servicio: { routeId: string | null; serviceDate: Date; ascentSlot: string },
  pedido: Pedido
) {
  if (servicioYaPaso(servicio.serviceDate, pedido.ahora)) {
    throw new BookingError("SERVICE_ALREADY_STARTED", `El servicio ya pasó: no se puede ${pedido.accion}.`);
  }
  if (!esFranjaDeChapelco(servicio.ascentSlot) || !servicio.routeId) return;
  const [flota, vivas] = await Promise.all([
    tx.vehicle.findMany({ where: { isActive: true }, select: { _count: { select: { seats: true } } } }),
    tx.reservation.findMany({
      where: {
        routeId: servicio.routeId,
        bookingMode: "CHAPELCO",
        id: { not: pedido.excluir },
        status: { in: [...chapelcoActiveReservationStatuses] },
        chapelcoDetails: { serviceDate: servicio.serviceDate }
      },
      select: { passengerCount: true, chapelcoDetails: { select: { ascentSlot: true } } }
    })
  ]);
  const capacidad = flota.reduce((total, vehicle) => total + vehicle._count.seats, 0);
  const ocupados = personasQueBloqueanLaFranja(
    vivas.map((item) => ({ passengerCount: item.passengerCount, ascentSlot: item.chapelcoDetails?.ascentSlot ?? null })),
    servicio.ascentSlot
  );
  if (!hayLugar(capacidad, ocupados, pedido.pasajeros)) {
    throw new BookingError(
      "CAPACITY_FULL",
      `No hay lugar en esa franja: quedan ${lugaresLibres(capacidad, ocupados)} lugares y ${pedido.frase(pedido.pasajeros)}.`
    );
  }
}
