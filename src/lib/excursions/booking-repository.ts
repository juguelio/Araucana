import { prisma } from "@/lib/db/prisma";
import { rangoDelDia } from "@/lib/airport/booking";
import type { ExcursionSheetBookingInput } from "./sheet";

/**
 * Ventas de excursión de un día, con lo que necesita la planilla (#110).
 *
 * El día se busca por `departureAt` (la salida que se vendió), no por `createdAt`: la planilla es de
 * lo que sale ese día. Las canceladas quedan afuera; las que tienen el pago pendiente entran, porque el
 * guía cobra contra esa hoja — igual que la orden de servicio del chofer.
 */
export async function getExcursionBookingsForDay(
  date: string,
  excursionId?: string | null
): Promise<ExcursionSheetBookingInput[]> {
  const { desde, hasta } = rangoDelDia(date);

  const bookings = await prisma.excursionBooking.findMany({
    where: {
      status: { not: "CANCELLED" },
      departureAt: { gte: desde, lt: hasta },
      ...(excursionId ? { excursionId } : {})
    },
    orderBy: [{ departureAt: "asc" }, { createdAt: "asc" }],
    include: {
      excursion: { select: { id: true, name: true, duration: true } },
      passenger: true
    }
  });

  return bookings.map((booking) => ({
    code: booking.code,
    excursionId: booking.excursionId,
    excursionName: booking.excursion.name,
    duration: booking.excursion.duration,
    departureAt: booking.departureAt,
    passengerCount: booking.passengerCount,
    totalCents: booking.totalCents,
    currency: booking.currency,
    status: booking.status,
    referredBy: booking.referredBy,
    passenger: {
      firstName: booking.passenger.firstName,
      lastName: booking.passenger.lastName,
      documentType: booking.passenger.documentType,
      documentId: booking.passenger.documentId,
      phone: booking.passenger.phone,
      email: booking.passenger.email
    }
  }));
}

export type NuevaVentaDeExcursion = {
  excursionId: string;
  departureAt: Date;
  passengerCount: number;
  totalCents: number;
  currency?: string;
  referredBy?: string | null;
  notes?: string | null;
  passenger: {
    firstName: string;
    lastName: string;
    email?: string;
    phone: string;
    documentType: string;
    documentId: string;
    nationality?: string | null;
  };
  code: string;
  shortCode: string;
};

/** Alta manual de una venta de excursión desde el panel (el cliente carga las derivaciones a mano). */
export async function createExcursionBooking(input: NuevaVentaDeExcursion) {
  return prisma.$transaction(async (tx) => {
    const passenger = await tx.passenger.create({
      data: {
        firstName: input.passenger.firstName.trim(),
        lastName: input.passenger.lastName.trim(),
        email: input.passenger.email?.trim() ?? "",
        phone: input.passenger.phone.trim(),
        documentType: input.passenger.documentType.trim(),
        documentId: input.passenger.documentId.trim(),
        nationality: input.passenger.nationality?.trim() || null
      }
    });

    return tx.excursionBooking.create({
      data: {
        code: input.code,
        shortCode: input.shortCode,
        excursionId: input.excursionId,
        departureAt: input.departureAt,
        passengerId: passenger.id,
        passengerCount: input.passengerCount,
        totalCents: input.totalCents,
        currency: input.currency ?? "ARS",
        referredBy: input.referredBy?.trim() || null,
        notes: input.notes?.trim() || null
      }
    });
  });
}
