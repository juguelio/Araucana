import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { isInsideAirportPickupZone, OUTSIDE_PICKUP_ZONE } from "@/lib/airport/pickup-zone";
import { airportPickupPointSchema } from "@/lib/airport/validation";
import { DISABILITY_DOCUMENT_PROVIDER } from "./disability-fare";
import { canCorrectManualPayment, canEditReservationTotal, reservationPriceCents } from "./admin-price";
import { BookingError } from "./repository";

const paymentFields = {
  method: z.string().trim().max(60).optional(),
  reference: z.string().trim().max(120)
};

export const reservationManagementSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("cancel") }),
  z.object({ operation: z.literal("delete") }),
  z.object({ operation: z.literal("confirm") }),
  z.object({ operation: z.literal("payment"), ...paymentFields }),
  z.object({ operation: z.literal("correctPayment"), ...paymentFields, totalCents: reservationPriceCents }),
  z.object({ operation: z.literal("price"), totalCents: reservationPriceCents }),
  z.object({ operation: z.literal("notes"), notes: z.string().trim().max(300) }),
  z.object({
    operation: z.literal("address"),
    address: z.string().trim().max(180),
    point: airportPickupPointSchema
  })
]);

type ReservationOperation = z.infer<typeof reservationManagementSchema>;

export async function manageReservation(code: string, command: ReservationOperation) {
  try {
    return await prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { code },
        include: { payment: true }
      });
      if (!reservation) throw new BookingError("RESERVATION_NOT_FOUND", "No encontramos la reserva.");

      const { id, status, payment } = reservation;
      const paid = payment?.status === "APPROVED" && payment.provider !== DISABILITY_DOCUMENT_PROVIDER;
      const needsDocumentation = status === "DOCUMENTATION_PENDING" || payment?.provider === DISABILITY_DOCUMENT_PROVIDER;

      switch (command.operation) {
        case "cancel":
          if (status === "CANCELLED") break;
          await tx.reservation.update({ where: { id }, data: { status: "CANCELLED", seatId: null, seatNumber: null } });
          await tx.chapelcoManifestStop.deleteMany({ where: { reservationId: id, status: "PENDING" } });
          break;
        case "delete":
          if (paid) throw new BookingError("PAYMENT_LOCKED", "La reserva tiene un pago registrado. Podés cancelarla para conservar el registro contable.");
          await tx.reservation.delete({ where: { id } });
          return { receiptPath: payment?.receiptBlobPathname };
        case "confirm":
          if (status === "CONFIRMED") break;
          if (status !== "PENDING_PAYMENT" || needsDocumentation || (reservation.totalCents > 0 && !paid)) {
            throw new BookingError("RESERVATION_LOCKED", "Para confirmar esta reserva primero hay que registrar el pago o aprobar la documentación correspondiente.");
          }
          await tx.reservation.update({ where: { id }, data: { status: "CONFIRMED" } });
          break;
        case "payment":
          if (!["PENDING_PAYMENT", "CONFIRMED"].includes(status) || needsDocumentation || reservation.totalCents <= 0 ||
              (payment && (payment.provider !== "MANUAL" || !["PENDING", "REJECTED"].includes(payment.status)))) {
            throw new BookingError("PAYMENT_LOCKED", "La reserva no admite un nuevo pago manual.");
          }
          const paymentData = {
            status: "APPROVED",
            amountCents: reservation.totalCents,
            currency: reservation.currency,
            ...(command.method ? { method: command.method } : {}),
            externalRef: command.reference || null
          };
          await tx.payment.upsert({
            where: { reservationId: id },
            update: paymentData,
            create: { ...paymentData, reservationId: id, provider: "MANUAL" }
          });
          break;
        case "correctPayment":
          if (!canCorrectManualPayment(status, payment)) {
            throw new BookingError("PAYMENT_LOCKED", "Esta reserva no tiene un pago manual que se pueda corregir.");
          }
          await tx.reservation.update({ where: { id }, data: { totalCents: command.totalCents } });
          await tx.payment.update({
            where: { reservationId: id },
            data: {
              amountCents: command.totalCents,
              method: command.method || null,
              externalRef: command.reference || null
            }
          });
          break;
        case "price":
          if (!canEditReservationTotal(status, payment)) {
            throw new BookingError("PAYMENT_LOCKED", "El precio solo se puede cambiar mientras la reserva esté pendiente y sin un comprobante por revisar.");
          }
          await tx.reservation.update({ where: { id }, data: { totalCents: command.totalCents } });
          if (payment) await tx.payment.update({ where: { reservationId: id }, data: { amountCents: command.totalCents } });
          break;
        case "address": {
          if (status === "CANCELLED") throw new BookingError("RESERVATION_LOCKED", "La reserva está cancelada.");
          const [pickupLatitude, pickupLongitude] = command.point;
          const position = { pickupLatitude, pickupLongitude };
          const where = { reservationId: id };

          if (reservation.bookingMode === "AIRPORT") {
            if (command.address.length > 160) {
              throw new BookingError("INVALID_PICKUP_ADDRESS", "La dirección puede tener hasta 160 caracteres.");
            }
            const coverage = await getAirportCoverage(tx);
            if (coverage.enabled && !isInsideAirportPickupZone(command.point, coverage)) {
              throw new BookingError("OUTSIDE_PICKUP_ZONE", OUTSIDE_PICKUP_ZONE);
            }
            await tx.airportReservationDetails.update({
              where, data: { ...position, pickupAddress: command.address || null }
            });
          } else if (reservation.bookingMode === "CHAPELCO") {
            if (command.address.length < 4) {
              throw new BookingError("INVALID_PICKUP_ADDRESS", "Ingresá una dirección para el traslado.");
            }
            const data = { ...position, pickupAddress: command.address };
            await tx.chapelcoReservationDetails.update({ where, data });
            await tx.chapelcoManifestStop.updateMany({ where: { ...where, status: "PENDING" }, data });
          } else {
            throw new BookingError("RESERVATION_LOCKED", "Esta reserva no tiene dirección de traslado.");
          }
          break;
        }
        case "notes":
          if (status === "CANCELLED") throw new BookingError("RESERVATION_LOCKED", "La reserva está cancelada.");
          if (reservation.bookingMode === "AIRPORT") {
            await tx.airportReservationDetails.update({ where: { reservationId: id }, data: { pickupNotes: command.notes || null } });
          } else if (reservation.bookingMode === "CHAPELCO") {
            await tx.chapelcoReservationDetails.update({ where: { reservationId: id }, data: { pickupNotes: command.notes || null } });
          } else {
            throw new BookingError("RESERVATION_LOCKED", "Esta reserva no tiene notas de traslado.");
          }
          break;
      }

      return { receiptPath: null };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") {
      throw new BookingError("BOOKING_BUSY", "Otro operador modificó esta reserva. Revisá el estado e intentalo de nuevo.");
    }
    throw error;
  }
}
