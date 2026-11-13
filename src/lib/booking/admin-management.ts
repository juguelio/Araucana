import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { isInsideAirportPickupZone, OUTSIDE_PICKUP_ZONE } from "@/lib/airport/pickup-zone";
import { airportPickupPointSchema } from "@/lib/airport/validation";
import { DISABILITY_DOCUMENT_PROVIDER } from "./disability-fare";
import { canCorrectManualPayment, canEditReservationTotal, canRegisterManualPayment, reservationPriceCents } from "./admin-price";
import { BookingError, firstAvailableSeat } from "./repository";
import { adminPassengerPatchSchema, referredBySchema } from "./validation";
import { normalizePassengerDocument, passengerDocumentError } from "./passenger-contact";
import { capacidadDeVuelo, pasajerosOcupados } from "@/lib/airport/booking";
import { chapelcoActiveReservationStatuses } from "@/lib/chapelco/constants";
import { esFranjaDeChapelco, hayLugar, lugaresLibres, personasQueBloqueanLaFranja, restoredStatus, servicioYaPaso, vueloYaPaso } from "./restore";

const paymentFields = {
  method: z.string().trim().max(60).optional(),
  reference: z.string().trim().max(120)
};

// Motivo de la cancelación (#108): el cliente pidió que cancelar pida una descripción del porqué.
// Se exige en el servidor (no sólo en el botón) para que la cancelación nunca quede sin motivo.
const cancellationReason = z
  .string()
  .trim()
  .min(3, "Escribí el motivo de la cancelación (al menos 3 caracteres).")
  .max(300, "El motivo de la cancelación puede tener hasta 300 caracteres.");

export const reservationManagementSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("cancel"),
    reason: cancellationReason,
    // Quién canceló, armado por el server action desde la sesión (no viaja por el formulario).
    cancelledBy: z.string().trim().max(120).optional()
  }),
  z.object({ operation: z.literal("delete") }),
  z.object({ operation: z.literal("confirm") }),
  z.object({
    operation: z.literal("restore"),
    // Quién restituyó, armado por el server action desde la sesión (no viaja por el formulario).
    restoredBy: z.string().trim().max(120).optional()
  }),
  z.object({ operation: z.literal("payment"), ...paymentFields }),
  z.object({ operation: z.literal("correctPayment"), ...paymentFields, totalCents: reservationPriceCents }),
  z.object({ operation: z.literal("price"), totalCents: reservationPriceCents }),
  z.object({
    operation: z.literal("edit"),
    passenger: adminPassengerPatchSchema,
    pickup: z.object({ address: z.string().trim().max(180), point: airportPickupPointSchema }).optional(),
    notes: z.string().trim().max(300).optional(),
    /** Quién derivó la venta (#109). Vacío borra el dato: la columna del Excel vuelve a salir vacía. */
    referredBy: referredBySchema,
    financial: z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("price"), totalCents: reservationPriceCents }),
      z.object({
        operation: z.literal("correctPayment"),
        totalCents: reservationPriceCents.optional(),
        method: paymentFields.method,
        reference: paymentFields.reference.optional()
      }).refine(({ totalCents, method, reference }) => totalCents !== undefined || method !== undefined || reference !== undefined)
    ]).optional()
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
          await tx.reservation.update({
            where: { id },
            data: {
              status: "CANCELLED",
              seatId: null,
              seatNumber: null,
              cancellationReason: command.reason,
              cancelledAt: new Date(),
              cancelledByName: command.cancelledBy ?? null
            }
          });
          await tx.chapelcoManifestStop.deleteMany({ where: { reservationId: id, status: "PENDING" } });
          break;
        case "restore": {
          // Restitución (#117): volver atrás sin borrar la reserva. Se exigen las mismas condiciones
          // que un alta —servicio futuro y cupo— para no dejar una reserva imposible en la base.
          if (status !== "CANCELLED") {
            throw new BookingError("RESERVATION_NOT_CANCELLED", "La reserva no está cancelada.");
          }
          const ahora = new Date();
          let seatId: string | null = null;
          let seatNumber: string | null = null;

          if (reservation.bookingMode === "SEATED") {
            const schedule = reservation.scheduleId
              ? await tx.schedule.findUnique({
                  where: { id: reservation.scheduleId },
                  include: {
                    route: { select: { isActive: true } },
                    vehicle: { select: { isActive: true, seats: true } },
                    reservations: { select: { id: true, status: true, passengerCount: true, seatId: true, seatNumber: true } }
                  }
                })
              : null;
            if (!schedule) {
              throw new BookingError("SCHEDULE_NOT_FOUND", "La salida de esta reserva ya no existe.");
            }
            if (!["OPEN", "DOCUMENTATION"].includes(schedule.status) || schedule.departureAt <= ahora || !schedule.route.isActive || schedule.vehicle.isActive === false) {
              throw new BookingError("SERVICE_ALREADY_STARTED", "La salida ya arrancó o se cerró: no se puede restituir la reserva.");
            }
            const vivas = schedule.reservations.filter((item) => item.id !== id && item.status !== "CANCELLED");
            const ocupados = vivas.reduce((total, item) => total + item.passengerCount, 0);
            const capacidad = schedule.vehicle.seats.length;
            if (!hayLugar(capacidad, ocupados, reservation.passengerCount)) {
              throw new BookingError(
                "CAPACITY_FULL",
                `No hay lugar en esa salida: quedan ${lugaresLibres(capacidad, ocupados)} lugares y la reserva ocupa ${reservation.passengerCount}.`
              );
            }
            const seat = firstAvailableSeat(
              schedule.vehicle.seats,
              new Set(vivas.map((item) => item.seatId)),
              new Set(vivas.map((item) => item.seatNumber))
            );
            seatId = seat?.id ?? null;
            seatNumber = seat?.number ?? null;
          } else if (reservation.bookingMode === "AIRPORT") {
            const details = await tx.airportReservationDetails.findUnique({
              where: { reservationId: id },
              include: {
                flight: {
                  include: {
                    reservations: { select: { reservation: { select: { passengerCount: true, status: true } } } },
                    assignments: { select: { vehicle: { select: { seats: { select: { id: true } } } } } }
                  }
                }
              }
            });
            if (!details) {
              throw new BookingError("RESERVATION_LOCKED", "La reserva no tiene los datos del vuelo.");
            }
            const vuelo = details.flight;
            if (vuelo) {
              if (vuelo.status === "CANCELLED" || vuelo.status === "DIVERTED") {
                throw new BookingError("FLIGHT_NOT_BOOKABLE", "El vuelo está cancelado o desviado: no se puede restituir la reserva.");
              }
              if (vueloYaPaso(vuelo, ahora)) {
                throw new BookingError(
                  "SERVICE_ALREADY_STARTED",
                  details.direction === "ARRIVAL" ? "El vuelo ya llegó: no se puede restituir la reserva." : "El vuelo ya salió: no se puede restituir la reserva."
                );
              }
              const ocupados = pasajerosOcupados(vuelo.reservations.map((item) => item.reservation));
              const capacidad = capacidadDeVuelo(vuelo.assignments.map((item) => ({ seats: item.vehicle.seats.length })));
              if (!hayLugar(capacidad, ocupados, reservation.passengerCount)) {
                throw new BookingError(
                  "CAPACITY_FULL",
                  `No hay lugar en ese vuelo: quedan ${lugaresLibres(capacidad, ocupados)} lugares y la reserva ocupa ${reservation.passengerCount}.`
                );
              }
            } else if (servicioYaPaso(details.serviceDate, ahora)) {
              throw new BookingError("SERVICE_ALREADY_STARTED", "El servicio ya pasó: no se puede restituir la reserva.");
            }
          } else if (reservation.bookingMode === "CHAPELCO") {
            const details = await tx.chapelcoReservationDetails.findUnique({ where: { reservationId: id } });
            if (!details) {
              throw new BookingError("RESERVATION_LOCKED", "La reserva no tiene los datos del servicio.");
            }
            if (servicioYaPaso(details.serviceDate, ahora)) {
              throw new BookingError("SERVICE_ALREADY_STARTED", "El servicio ya pasó: no se puede restituir la reserva.");
            }
            if (esFranjaDeChapelco(details.ascentSlot) && reservation.routeId) {
              const [flota, vivas] = await Promise.all([
                tx.vehicle.findMany({ where: { isActive: true }, select: { _count: { select: { seats: true } } } }),
                tx.reservation.findMany({
                  where: {
                    routeId: reservation.routeId,
                    bookingMode: "CHAPELCO",
                    id: { not: id },
                    status: { in: [...chapelcoActiveReservationStatuses] },
                    chapelcoDetails: { serviceDate: details.serviceDate }
                  },
                  select: { passengerCount: true, chapelcoDetails: { select: { ascentSlot: true } } }
                })
              ]);
              const capacidad = flota.reduce((total, vehicle) => total + vehicle._count.seats, 0);
              const ocupados = personasQueBloqueanLaFranja(
                vivas.map((item) => ({ passengerCount: item.passengerCount, ascentSlot: item.chapelcoDetails?.ascentSlot ?? null })),
                details.ascentSlot
              );
              if (!hayLugar(capacidad, ocupados, reservation.passengerCount)) {
                throw new BookingError(
                  "CAPACITY_FULL",
                  `No hay lugar en esa franja: quedan ${lugaresLibres(capacidad, ocupados)} lugares y la reserva ocupa ${reservation.passengerCount}.`
                );
              }
            }
          }

          await tx.reservation.update({
            where: { id },
            data: {
              status: restoredStatus({ payment, disabilityProvider: DISABILITY_DOCUMENT_PROVIDER }),
              seatId,
              seatNumber,
              restoredAt: ahora,
              restoredByName: command.restoredBy ?? null
            }
          });
          break;
        }
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
          if (!canRegisterManualPayment(status, reservation.totalCents, payment)) {
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
        case "price":
        case "edit": {
          const financial = command.operation === "edit" ? command.financial : command;
          if (financial?.operation === "price") {
            if (!canEditReservationTotal(status, payment)) {
              throw new BookingError("PAYMENT_LOCKED", "El precio solo se puede cambiar mientras la reserva esté pendiente y sin un comprobante por revisar.");
            }
            await tx.reservation.update({ where: { id }, data: { totalCents: financial.totalCents } });
            if (payment) await tx.payment.update({ where: { reservationId: id }, data: { amountCents: financial.totalCents } });
          } else if (financial?.operation === "correctPayment") {
            if (!canCorrectManualPayment(status, payment)) {
              throw new BookingError("PAYMENT_LOCKED", "Esta reserva no tiene un pago manual que se pueda corregir.");
            }
            const { totalCents, method, reference } = financial;
            if (totalCents !== undefined) {
              await tx.reservation.update({ where: { id }, data: { totalCents } });
            }
            await tx.payment.update({
              where: { reservationId: id },
              data: {
                ...(totalCents !== undefined && { amountCents: totalCents }),
                ...((method !== undefined || command.operation === "correctPayment") && { method: method || null }),
                ...(reference !== undefined && { externalRef: reference || null })
              }
            });
          }

          if (command.operation !== "edit") break;
          const { pickup, notes, passenger, referredBy } = command;
          // El origen de la venta no es logística: se puede corregir incluso con la reserva
          // cancelada, y vacío borra el dato (#109).
          if (referredBy !== undefined) {
            await tx.reservation.update({ where: { id }, data: { referredBy: referredBy || null } });
          }
          if (pickup || notes !== undefined) {
            if (status === "CANCELLED") throw new BookingError("RESERVATION_LOCKED", "La reserva está cancelada.");
            const where = { reservationId: id };
            const notesData = notes === undefined ? {} : { pickupNotes: notes || null };
            const addressData = pickup && {
              pickupAddress: pickup.address,
              pickupLatitude: pickup.point[0],
              pickupLongitude: pickup.point[1]
            };

            if (reservation.bookingMode === "AIRPORT") {
              if (pickup) {
                if (pickup.address.length > 160) {
                  throw new BookingError("INVALID_PICKUP_ADDRESS", "La dirección puede tener hasta 160 caracteres.");
                }
                const coverage = await getAirportCoverage(tx);
                if (coverage.enabled && !isInsideAirportPickupZone(pickup.point, coverage)) {
                  throw new BookingError("OUTSIDE_PICKUP_ZONE", OUTSIDE_PICKUP_ZONE);
                }
              }
              await tx.airportReservationDetails.update({
                where, data: { ...notesData, ...(addressData && { ...addressData, pickupAddress: addressData.pickupAddress || null }) }
              });
            } else if (reservation.bookingMode === "CHAPELCO") {
              if (addressData && addressData.pickupAddress.length < 4) {
                throw new BookingError("INVALID_PICKUP_ADDRESS", "Ingresá una dirección para el traslado.");
              }
              await tx.chapelcoReservationDetails.update({ where, data: { ...notesData, ...addressData } });
              if (addressData) {
                await tx.chapelcoManifestStop.updateMany({ where: { ...where, status: "PENDING" }, data: addressData });
              }
            } else {
              throw new BookingError("RESERVATION_LOCKED", "Esta reserva no tiene datos de traslado.");
            }
          }

          if (Object.keys(passenger).length > 0) {
            const where = { id: reservation.passengerId };
            const data = { ...passenger };
            if (data.documentType !== undefined || data.documentId !== undefined) {
              const saved = await tx.passenger.findUniqueOrThrow({ where, select: { documentType: true, documentId: true } });
              const documentType = data.documentType ?? saved.documentType;
              const documentId = data.documentId ?? saved.documentId;
              const error = passengerDocumentError(documentType, documentId, true);
              if (error) throw new BookingError("INVALID_PASSENGER_DOCUMENT", error);
              const normalizedId = normalizePassengerDocument(documentType, documentId);
              if (data.documentId !== undefined || normalizedId !== saved.documentId) data.documentId = normalizedId;
            }
            await tx.passenger.update({ where, data });
          }
          break;
        }
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
