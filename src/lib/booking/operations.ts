import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ADMIN_PAYMENT_QUEUES, adminReservationWhere, type AdminPaymentQueue } from "./admin-filters";

/**
 * Lo que hay que hacer hoy en la oficina, en una sola lectura: comprobantes subidos esperando
 * validación, comprobantes rechazados a los que hay que volver a pedirles el pago, las salidas que
 * vienen con su ocupación y los vuelos que tienen pasajeros pero ninguna unidad asignada.
 *
 * Cada número sale de una query; el panel no inventa métricas. Los items son una muestra corta
 * (la lista completa vive en el listado filtrado al que linkea cada tarjeta).
 */

export type AdminReceiptRow = {
  code: string;
  passenger: string;
  amountCents: number;
  currency: string;
  uploadedAt: Date | null;
};

export type AdminUpcomingDeparture = {
  id: string;
  routeLabel: string;
  departureAt: Date;
  occupied: number;
  capacity: number;
  vehicle: string;
};

export type AdminOperationsSummary = {
  receiptsPending: { count: number; items: AdminReceiptRow[] };
  receiptsRejected: { count: number; items: AdminReceiptRow[] };
  upcomingDepartures: AdminUpcomingDeparture[];
  flightsWithoutVehicle: number;
};

/** Cuántos items trae cada cola en el panel; el resto se ve entrando a la lista filtrada. */
export const ADMIN_OPERATIONS_SAMPLE = 4;

const receiptSelect = {
  code: true,
  passenger: { select: { firstName: true, lastName: true } },
  totalCents: true,
  currency: true,
  payment: { select: { receiptUploadedAt: true, updatedAt: true } }
} satisfies Prisma.ReservationSelect;

function receiptQueueWhere(queue: AdminPaymentQueue): Prisma.ReservationWhereInput {
  // Se reusa el mismo `where` que el listado para que el número de la tarjeta coincida con la
  // cantidad de filas que aparecen al hacer click.
  return adminReservationWhere({ payment: queue });
}

function toReceiptRow(reservation: {
  code: string;
  passenger: { firstName: string; lastName: string };
  totalCents: number;
  currency: string;
  payment: { receiptUploadedAt: Date | null } | null;
}): AdminReceiptRow {
  return {
    code: reservation.code,
    passenger: `${reservation.passenger.firstName} ${reservation.passenger.lastName}`.trim(),
    amountCents: reservation.totalCents,
    currency: reservation.currency,
    uploadedAt: reservation.payment?.receiptUploadedAt ?? null
  };
}

export async function getAdminOperationsSummary(now = new Date()): Promise<AdminOperationsSummary> {
  const [pending, rejected] = ADMIN_PAYMENT_QUEUES;

  const [pendingCount, pendingRows, rejectedCount, rejectedRows, departures, flightsWithoutVehicle] = await Promise.all([
    prisma.reservation.count({ where: receiptQueueWhere(pending) }),
    prisma.reservation.findMany({
      where: receiptQueueWhere(pending),
      // Primero el comprobante que espera hace más tiempo: es la cola, no una lista de novedades.
      orderBy: [{ payment: { receiptUploadedAt: "asc" } }, { createdAt: "asc" }],
      take: ADMIN_OPERATIONS_SAMPLE,
      select: receiptSelect
    }),
    prisma.reservation.count({ where: receiptQueueWhere(rejected) }),
    prisma.reservation.findMany({
      where: receiptQueueWhere(rejected),
      orderBy: { updatedAt: "asc" },
      take: ADMIN_OPERATIONS_SAMPLE,
      select: receiptSelect
    }),
    prisma.schedule.findMany({
      where: { departureAt: { gte: now }, status: { in: ["OPEN", "DOCUMENTATION"] } },
      orderBy: { departureAt: "asc" },
      take: ADMIN_OPERATIONS_SAMPLE,
      select: {
        id: true,
        departureAt: true,
        route: { select: { from: true, to: true } },
        vehicle: { select: { name: true, _count: { select: { seats: true } } } },
        reservations: { select: { passengerCount: true, status: true } }
      }
    }),
    // El único lugar donde puede faltar unidad es el aeropuerto: la salida regular exige `vehicleId`.
    prisma.flight.count({
      where: {
        scheduledAt: { gte: now },
        assignments: { none: {} },
        reservations: { some: { reservation: { status: { not: "CANCELLED" } } } }
      }
    })
  ]);

  return {
    receiptsPending: { count: pendingCount, items: pendingRows.map(toReceiptRow) },
    receiptsRejected: { count: rejectedCount, items: rejectedRows.map(toReceiptRow) },
    upcomingDepartures: departures.map((departure) => {
      const ocupadas = departure.reservations
        .filter((reservation) => reservation.status !== "CANCELLED")
        .reduce((suma, reservation) => suma + reservation.passengerCount, 0);
      return {
        id: departure.id,
        routeLabel: `${departure.route.from} → ${departure.route.to}`,
        departureAt: departure.departureAt,
        occupied: ocupadas,
        capacity: departure.vehicle._count.seats,
        vehicle: departure.vehicle.name
      };
    }),
    flightsWithoutVehicle
  };
}
