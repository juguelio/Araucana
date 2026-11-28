import { isPaihuen, PAIHUEN_UNIT_CENTS } from "@/lib/airport/paihuen";
import { getAirportExtras } from "@/lib/airport/extras-settings";
import { MAX_SPORTS_LUGGAGE } from "@/lib/airport/extras";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { chargesZoneExtra, isInsideAirportPickupZone, OUTSIDE_PICKUP_ZONE } from "@/lib/airport/pickup-zone";
import { airportPickupPointSchema } from "@/lib/airport/validation";
import { DISABILITY_DOCUMENT_PROVIDER } from "./disability-fare";
import { canCorrectManualPayment, canEditReservationTotal, canRegisterManualPayment, reservationPriceCents } from "./admin-price";
import { BookingError, firstAvailableSeat } from "./repository";
import { extraUnitsSeatsInclude, scheduleSeatCount, scheduleSeatPool } from "./schedule-units";
import { MAX_PASSENGERS, errorDeMenores, tarifaPorPersona, totalAlEditar } from "./reservation-edit";
import { segmentPrice } from "./segment-fares";
import { lugarEnChapelco, lugarEnSalida, lugarEnVuelo } from "./service-capacity";
import { adminPassengerPatchSchema, referredBySchema } from "./validation";
import { normalizePassengerDocument, passengerDocumentError } from "./passenger-contact";
import { motivoNoReservable, rangoDelDia } from "@/lib/airport/booking";
import { incluirCupoDelVuelo, leerCupoDeRecorrida } from "@/lib/airport/recorrida-capacity";
import { argentinaDateKey } from "./admin-filters";
import { chapelcoActiveReservationStatuses } from "@/lib/chapelco/constants";
import { diffRecords, hasChanges } from "@/lib/audit/diff";
import { recordAudit, type AuditAction, type AuditActor } from "@/lib/audit/record";
import { reservationAuditInclude, reservationAuditSnapshot, reservationPassengerName, withShortCode } from "@/lib/audit/reservation";
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
    /**
     * `point` puede faltar: el alojamiento que ningún geocoder ubica se carga como texto y queda
     * sin coordenadas (#268), el mismo camino que ya existía para una dirección sin geometría.
     */
    pickup: z.object({ address: z.string().trim().max(180), point: airportPickupPointSchema.nullish() })
      .refine(({ address, point }) => Boolean(point) || address.length > 0, {
        path: ["address"],
        message: "Escribí el domicilio o marcá el punto en el mapa."
      })
      .optional(),
    notes: z.string().trim().max(300).optional(),
    /** Quién derivó la venta (#109). Vacío borra el dato: la columna del Excel vuelve a salir vacía. */
    referredBy: referredBySchema,
    /**
     * Cantidad de lugares que ocupa la reserva (#267). `passengerCount` incluye a los menores: no
     * puede bajar de `halfFareCount + freeFareCount` ni pasar el cupo del servicio.
     */
    passengerCount: z.coerce.number().int().min(1, "La reserva necesita al menos un pasajero.")
      .max(MAX_PASSENGERS, `La cantidad de pasajeros no puede superar ${MAX_PASSENGERS}.`).optional(),
    /**
     * Menores (media tarifa de 4 a 8 años y sin cargo menores de 4). Van dentro de
     * `passengerCount`: no ocupan lugares aparte, sólo cambian el precio.
     */
    halfFareCount: z.coerce.number().int().min(0, "Cantidad inválida.").max(MAX_PASSENGERS).optional(),
    freeFareCount: z.coerce.number().int().min(0, "Cantidad inválida.").max(MAX_PASSENGERS).optional(),
    /** Parada donde baja en una ruta con paradas intermedias. Vacío = baja en el destino final. */
    boardingStop: z.string().trim().max(160).optional(),
    dropoffStop: z.string().trim().max(160).optional(),
    /** Nombre del lugar del traslado (hotel, cabaña) que sale en la orden del chofer. Vacío lo borra. */
    pickupName: z.string().trim().max(120).optional(),
    /**
     * Pasar la reserva a otro servicio del mismo tipo: otra salida (ruta), otro vuelo (aeropuerto,
     * también de otro sentido o día) u otra fecha/franja (Chapelco). Se exige lo mismo que un alta:
     * servicio futuro, abierto y con lugar.
     */
    move: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("SEATED"), scheduleId: z.string().min(1, "Elegí la salida.") }),
      z.object({ mode: z.literal("AIRPORT"), flightId: z.string().min(1, "Elegí el vuelo.") }),
      z.object({
        mode: z.literal("CHAPELCO"),
        serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elegí una fecha válida."),
        ascentSlot: z.string().trim().min(1, "Elegí la franja.").max(20)
      })
    ]).optional(),
    /** Bultos de equipaje deportivo del aeropuerto (#267). No existe en los otros modos. */
    sportsLuggageCount: z.coerce.number().int().min(0, "Cantidad inválida.")
      .max(MAX_SPORTS_LUGGAGE, "Máximo 24 bultos por reserva.").optional(),
    /**
     * El operador vio la diferencia del total antes de guardar (#267). Sólo se exige cuando el pago
     * ya está aprobado: el monto del pago no se toca sin que alguien lo haya confirmado.
     */
    acknowledgeTotalChange: z.boolean().optional(),
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

/** Cómo queda anotada cada operación en la auditoría. */
const auditOfOperation: Record<ReservationOperation["operation"], { action: AuditAction; summary: string }> = {
  cancel: { action: "CANCEL", summary: "Reserva cancelada." },
  restore: { action: "RESTORE", summary: "Reserva restituida." },
  delete: { action: "DELETE", summary: "Reserva borrada." },
  confirm: { action: "CONFIRM", summary: "Reserva confirmada." },
  payment: { action: "PAYMENT_REGISTERED", summary: "Pago registrado a mano." },
  correctPayment: { action: "UPDATE", summary: "Datos del pago corregidos." },
  price: { action: "UPDATE", summary: "Precio de la reserva modificado." },
  edit: { action: "UPDATE", summary: "Datos de la reserva editados." }
};

/**
 * `actor` es quién hace la operación (lo arma el server action o la ruta desde la sesión). La
 * auditoría se escribe en esta misma transacción: no queda un cambio sin su registro.
 */
export async function manageReservation(code: string, command: ReservationOperation, actor?: AuditActor | null) {
  try {
    return await prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { code },
        include: reservationAuditInclude
      });
      if (!reservation) throw new BookingError("RESERVATION_NOT_FOUND", "No encontramos la reserva.");
      const before = reservationAuditSnapshot(reservation);
      const operationAudit = auditOfOperation[command.operation];
      const audit = {
        actor, entity: "RESERVATION" as const, entityId: reservation.id, entityLabel: code,
        action: operationAudit.action, summary: withShortCode(operationAudit.summary, reservation.shortCode)
      };

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
          if (reservation.airportDetails?.isPrivate) await tx.airportVehicleAssignment.deleteMany({ where: { privateReservationId: id } });
          await tx.chapelcoManifestStop.deleteMany({ where: { reservationId: id, status: "PENDING" } });
          // Boleto numerado (#370): conserva su número y queda ANULADO con motivo, fecha y usuario.
          if (reservation.bookingMode === "SEATED") {
            const boleto = await tx.serviceTicket.findUnique({ where: { reservationId: id } });
            if (boleto && boleto.status === "EMITIDO") {
              await tx.serviceTicket.update({
                where: { id: boleto.id },
                data: {
                  status: "ANULADO",
                  annulledAt: new Date(),
                  annulledById: actor?.id ?? null,
                  annulledByName: actor ? actor.name?.trim() || actor.email : command.cancelledBy ?? null,
                  annulReason: command.reason
                }
              });
            }
          }
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

          const pedido = {
            excluir: id, pasajeros: reservation.passengerCount, ahora,
            frase: (n: number) => `la reserva ocupa ${n}`, accion: "restituir la reserva"
          };
          if (reservation.bookingMode === "SEATED") {
            if (!reservation.scheduleId) throw new BookingError("SCHEDULE_NOT_FOUND", "La salida de esta reserva ya no existe.");
            ({ seatId, seatNumber } = await lugarEnSalida(tx, reservation.scheduleId, pedido));
          } else if (reservation.bookingMode === "AIRPORT") {
            const details = await tx.airportReservationDetails.findUnique({
              where: { reservationId: id },
              include: {
                flight: { include: incluirCupoDelVuelo }
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
              const extras = await getAirportExtras(tx);
              const closed = motivoNoReservable({ ...vuelo, direction: details.direction }, 1, ahora, extras.arrivalCutoffMinutes, extras.departureCutoffMinutes);
              if (closed) throw new BookingError("SERVICE_ALREADY_STARTED", closed);
              if (!details.isPrivate) {
                const { capacidad, ocupados, disponibles } = await leerCupoDeRecorrida(tx, vuelo, id);
                if (!hayLugar(capacidad, ocupados, reservation.passengerCount)) {
                  throw new BookingError(
                    "CAPACITY_FULL",
                    `No hay lugar en ese vuelo: quedan ${disponibles} lugares y la reserva ocupa ${reservation.passengerCount}.`
                  );
                }
              }
            } else if (servicioYaPaso(details.serviceDate, ahora)) {
              throw new BookingError("SERVICE_ALREADY_STARTED", "El servicio ya pasó: no se puede restituir la reserva.");
            }
          } else if (reservation.bookingMode === "CHAPELCO") {
            const details = await tx.chapelcoReservationDetails.findUnique({ where: { reservationId: id } });
            if (!details) {
              throw new BookingError("RESERVATION_LOCKED", "La reserva no tiene los datos del servicio.");
            }
            await lugarEnChapelco(tx, { routeId: reservation.routeId, serviceDate: details.serviceDate, ascentSlot: details.ascentSlot }, pedido);
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
          // La reserva vuelve a estar viva: el boleto anulado se reactiva con su mismo número
          // (la base guarda un boleto por reserva y éste nunca viajó).
          if (reservation.bookingMode === "SEATED") {
            const boleto = await tx.serviceTicket.findUnique({ where: { reservationId: id } });
            if (boleto && boleto.status === "ANULADO") {
              await tx.serviceTicket.update({
                where: { id: boleto.id },
                data: { status: "EMITIDO", annulledAt: null, annulledById: null, annulledByName: null, annulReason: null }
              });
            }
          }
          break;
        }
        case "delete":
          if (paid) throw new BookingError("PAYMENT_LOCKED", "La reserva tiene un pago registrado. Podés cancelarla para conservar el registro contable.");
          // Boleto numerado (#381): el número emitido no se reutiliza ni se pierde con la reserva.
          // La base también lo impide (`ON DELETE RESTRICT`); acá se devuelve el motivo legible.
          if (reservation.bookingMode === "SEATED") {
            const boleto = await tx.serviceTicket.findUnique({ where: { reservationId: id } });
            if (boleto) {
              throw new BookingError(
                "TICKET_LOCKED",
                `La reserva tiene el boleto ${boleto.displayNumber} de la serie: no se puede borrar porque el número emitido no se reutiliza. Cancelala para anular el boleto y conservar el registro.`
              );
            }
          }
          await tx.reservation.delete({ where: { id } });
          // La fila desaparece: en la auditoría queda la foto de lo que se borró.
          await recordAudit(tx, {
            ...audit,
            summary: withShortCode(`Reserva borrada${reservationPassengerName(reservation) ? ` (pasajero ${reservationPassengerName(reservation)})` : ""}.`, reservation.shortCode),
            changes: diffRecords(before, null)
          });
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
          const { pickup, notes, passenger, referredBy, passengerCount, sportsLuggageCount, halfFareCount, freeFareCount, boardingStop, dropoffStop, pickupName, move } = command;
          const mediasAhora = reservation.halfFareCount ?? 0;
          const sinCargoAhora = reservation.freeFareCount ?? 0;

          // Cantidad de pasajeros (#267): es lo que imprime la orden de servicio y lo que descuenta
          // lugares, así que se edita con la misma guarda de cupo que un alta. Una reserva cancelada
          // ya liberó su lugar: cambiarle la cantidad descuadraría un servicio que no va a existir.
          const cambiaCantidad = passengerCount !== undefined && passengerCount !== reservation.passengerCount;
          const privada = reservation.airportDetails?.isPrivate;
          if (privada && (cambiaCantidad || pickup || pickupName !== undefined)) {
            throw new BookingError("RESERVATION_LOCKED", "Editá las paradas y sus pasajeros desde la ficha del traslado privado.");
          }
          const cambiaEquipaje = sportsLuggageCount !== undefined && sportsLuggageCount !== (reservation.airportDetails?.sportsLuggageCount ?? 0);
          // Menores y bajada no ocupan lugares: sólo cambian el precio y lo que ve el chofer.
          const cambiaMenores = (halfFareCount !== undefined && halfFareCount !== mediasAhora)
            || (freeFareCount !== undefined && freeFareCount !== sinCargoAhora);
          const bajadaNueva = dropoffStop === undefined ? undefined : dropoffStop || null;
          const subidaNueva = boardingStop === undefined ? undefined : boardingStop || null;
          const cambiaSubida = subidaNueva !== undefined && subidaNueva !== (reservation.boardingStop ?? null);
          const cambiaBajada = bajadaNueva !== undefined && bajadaNueva !== (reservation.dropoffStop ?? null);
          if (move && move.mode !== reservation.bookingMode) {
            throw new BookingError("RESERVATION_LOCKED", "La reserva sólo se puede pasar a otro servicio del mismo tipo.");
          }
          if ((cambiaCantidad || cambiaEquipaje || cambiaMenores || cambiaSubida || cambiaBajada || move) && status === "CANCELLED") {
            throw new BookingError("RESERVATION_LOCKED", "La reserva está cancelada.");
          }
          if (sportsLuggageCount !== undefined && reservation.bookingMode !== "AIRPORT") {
            throw new BookingError("RESERVATION_LOCKED", "Esta reserva no tiene adicionales del aeropuerto.");
          }
          if ((cambiaSubida || cambiaBajada) && reservation.bookingMode !== "SEATED") {
            throw new BookingError("RESERVATION_LOCKED", "Esta reserva no tiene paradas intermedias.");
          }
          const pasajerosFinal = passengerCount ?? reservation.passengerCount;
          const mediasFinal = halfFareCount ?? mediasAhora;
          const sinCargoFinal = freeFareCount ?? sinCargoAhora;
          if (cambiaCantidad || cambiaMenores) {
            const error = errorDeMenores({ passengerCount: pasajerosFinal, halfFareCount: mediasFinal, freeFareCount: sinCargoFinal });
            if (error) {
              throw new BookingError(
                "INVALID_PASSENGER_COUNT",
                cambiaMenores ? error : `La reserva no puede quedar con ${pasajerosFinal} pasajeros: ${error.charAt(0).toLowerCase()}${error.slice(1)}`
              );
            }
            // La tarifa sin cargo por discapacidad es de un solo pasajero adulto, igual que en el alta.
            if (needsDocumentation && (pasajerosFinal > 1 || mediasFinal > 0 || sinCargoFinal > 0)) {
              throw new BookingError("INVALID_PASSENGER_COUNT", "La tarifa sin cargo por discapacidad es para un solo pasajero.");
            }
          }
          // ── Cambio de servicio ──────────────────────────────────────────────────────────────
          // Va antes que la cantidad: el cupo se mide en el servicio nuevo con la cantidad final.
          let movida = false;
          let rutaNuevaId: string | null = null;
          if (move) {
            const pedido = {
              excluir: id, pasajeros: pasajerosFinal, ahora: new Date(),
              frase: (n: number) => `la reserva quedaría con ${n}`, accion: "pasar la reserva a ese servicio"
            };
            if (move.mode === "SEATED" && move.scheduleId !== reservation.scheduleId) {
              const { schedule, seatId, seatNumber } = await lugarEnSalida(tx, move.scheduleId, pedido);
              if (schedule.route.bookingMode !== "SEATED") {
                throw new BookingError("RESERVATION_LOCKED", "Esa salida no es de una ruta con asientos.");
              }
              await tx.reservation.update({
                where: { id }, data: { scheduleId: schedule.id, routeId: schedule.routeId, seatId, seatNumber }
              });
              rutaNuevaId = schedule.routeId;
              movida = true;
            } else if (move.mode === "AIRPORT" && move.flightId !== reservation.airportDetails?.flightId) {
              if (!reservation.airportDetails) throw new BookingError("RESERVATION_LOCKED", "La reserva no tiene los datos del vuelo.");
              const vuelo = await lugarEnVuelo(tx, move.flightId, pedido, privada);
              if (privada) await tx.airportVehicleAssignment.deleteMany({ where: { privateReservationId: id } });
              // Otro sentido = otra tarifa: la ruta del sentido del vuelo manda, igual que en el alta.
              if (vuelo.direction !== reservation.airportDetails.direction) {
                const ruta = await tx.travelRoute.findFirst({
                  where: { bookingMode: "AIRPORT", specialType: vuelo.direction, isActive: true },
                  orderBy: { createdAt: "asc" },
                  select: { id: true }
                });
                if (!ruta) throw new BookingError("ROUTE_NOT_FOUND", "No hay tarifa activa para ese sentido del traslado al aeropuerto.");
                await tx.reservation.update({ where: { id }, data: { routeId: ruta.id } });
                rutaNuevaId = ruta.id;
              }
              await tx.airportReservationDetails.update({
                where: { reservationId: id },
                data: {
                  flightId: vuelo.id,
                  flightNumber: vuelo.number,
                  direction: vuelo.direction,
                  serviceDate: rangoDelDia(argentinaDateKey(vuelo.scheduledAt)).desde,
                  // La nave y el lugar en la recorrida eran del vuelo anterior: la orden los vuelve a armar.
                  assignmentId: null,
                  routePosition: null
                }
              });
              movida = true;
            } else if (move.mode === "CHAPELCO") {
              const detalles = await tx.chapelcoReservationDetails.findUnique({ where: { reservationId: id } });
              if (!detalles) throw new BookingError("RESERVATION_LOCKED", "La reserva no tiene los datos del servicio.");
              const serviceDate = new Date(`${move.serviceDate}T00:00:00.000Z`);
              const cambiaDia = serviceDate.getTime() !== detalles.serviceDate.getTime();
              if (cambiaDia || move.ascentSlot !== detalles.ascentSlot) {
                if (move.ascentSlot !== detalles.ascentSlot && !esFranjaDeChapelco(move.ascentSlot)) {
                  throw new BookingError("RESERVATION_LOCKED", "Elegí una de las franjas de subida.");
                }
                await lugarEnChapelco(tx, { routeId: reservation.routeId, serviceDate, ascentSlot: move.ascentSlot }, pedido);
                await tx.chapelcoReservationDetails.update({ where: { reservationId: id }, data: { serviceDate, ascentSlot: move.ascentSlot } });
                // Las paradas pendientes eran de la vuelta del día o franja anterior: se sacan y la
                // reserva vuelve a quedar para asignar en el tablero del día nuevo.
                await tx.chapelcoManifestStop.deleteMany({ where: { reservationId: id, status: "PENDING" } });
                movida = true;
              }
            }
          }

          if (cambiaCantidad && passengerCount !== undefined && !movida) {
            if (reservation.bookingMode === "SEATED") {
              const salida = reservation.scheduleId
                ? await tx.schedule.findUnique({
                    where: { id: reservation.scheduleId },
                    include: {
                      vehicle: { include: { seats: true } },
                      extraUnits: extraUnitsSeatsInclude,
                      reservations: { select: { id: true, status: true, passengerCount: true } }
                    }
                  })
                : null;
              if (!salida) throw new BookingError("SCHEDULE_NOT_FOUND", "La salida de esta reserva ya no existe.");
              const capacidad = scheduleSeatCount(salida);
              const ocupados = salida.reservations
                .filter((item) => item.id !== id && item.status !== "CANCELLED")
                .reduce((total, item) => total + item.passengerCount, 0);
              if (!hayLugar(capacidad, ocupados, passengerCount)) {
                throw new BookingError(
                  "CAPACITY_FULL",
                  `No hay lugar en esa salida: quedan ${lugaresLibres(capacidad, ocupados)} lugares y la reserva quedaría con ${passengerCount}.`
                );
              }
            } else if (reservation.bookingMode === "AIRPORT") {
              const detalles = reservation.airportDetails?.flightId
                ? await tx.airportReservationDetails.findUnique({
                    where: { reservationId: id },
                    include: {
                      flight: { include: incluirCupoDelVuelo }
                    }
                  })
                : null;
              const vuelo = detalles?.flight;
              if (vuelo && !detalles?.isPrivate) {
                const { naves, capacidad, ocupados, disponibles } = await leerCupoDeRecorrida(tx, vuelo, id);
                // Un vuelo suelto sin nave conserva la edición sin tope que ya usaba el panel.
                // Bajar la cantidad nunca ocupa un lugar nuevo: si la recorrida ya está sobrevendida,
                // el operador tiene que poder corregir la reserva para resolverla.
                const baja = passengerCount < reservation.passengerCount;
                if ((naves > 0 || vuelo.pickupGroupId) && !baja && !hayLugar(capacidad, ocupados, passengerCount)) {
                  throw new BookingError(
                    "CAPACITY_FULL",
                    `No hay lugar en ese vuelo: quedan ${disponibles} lugares y la reserva quedaría con ${passengerCount}.`
                  );
                }
              }
            } else if (reservation.bookingMode === "CHAPELCO") {
              const detalles = await tx.chapelcoReservationDetails.findUnique({ where: { reservationId: id } });
              if (!detalles) throw new BookingError("RESERVATION_LOCKED", "La reserva no tiene los datos del servicio.");
              if (esFranjaDeChapelco(detalles.ascentSlot) && reservation.routeId) {
                const [flota, vivas] = await Promise.all([
                  tx.vehicle.findMany({ where: { isActive: true }, select: { _count: { select: { seats: true } } } }),
                  tx.reservation.findMany({
                    where: {
                      routeId: reservation.routeId,
                      bookingMode: "CHAPELCO",
                      id: { not: id },
                      status: { in: [...chapelcoActiveReservationStatuses] },
                      chapelcoDetails: { serviceDate: detalles.serviceDate }
                    },
                    select: { passengerCount: true, chapelcoDetails: { select: { ascentSlot: true } } }
                  })
                ]);
                const capacidad = flota.reduce((total, vehicle) => total + vehicle._count.seats, 0);
                const ocupados = personasQueBloqueanLaFranja(
                  vivas.map((item) => ({ passengerCount: item.passengerCount, ascentSlot: item.chapelcoDetails?.ascentSlot ?? null })),
                  detalles.ascentSlot
                );
                if (!hayLugar(capacidad, ocupados, passengerCount)) {
                  throw new BookingError(
                    "CAPACITY_FULL",
                    `No hay lugar en esa franja: quedan ${lugaresLibres(capacidad, ocupados)} lugares y la reserva quedaría con ${passengerCount}.`
                  );
                }
              }
            }
          }
          if (cambiaCantidad && passengerCount !== undefined) {
            await tx.reservation.update({ where: { id }, data: { passengerCount } });
            // La planilla de Chapelco guarda su propia copia de la cantidad por parada: sin esto el
            // chofer seguiría viendo la cantidad vieja.
            if (reservation.bookingMode === "CHAPELCO") {
              await tx.chapelcoManifestStop.updateMany({
                where: { reservationId: id, status: "PENDING" },
                data: { passengerCount }
              });
            }
          }
          if (cambiaEquipaje && sportsLuggageCount !== undefined) {
            await tx.airportReservationDetails.update({
              where: { reservationId: id },
              data: { sportsLuggageCount }
            });
          }
          if (cambiaMenores) {
            await tx.reservation.update({ where: { id }, data: { halfFareCount: mediasFinal, freeFareCount: sinCargoFinal } });
            // El aeropuerto guarda también su copia de la media tarifa (la lee el detalle del traslado).
            if (reservation.bookingMode === "AIRPORT" && reservation.airportDetails) {
              await tx.airportReservationDetails.update({ where: { reservationId: id }, data: { halfFareCount: mediasFinal } });
            }
          }

          // Ruta con paradas: la bajada tiene que ser una de las paradas con tarifa de la ruta, y
          // cambia la tarifa por persona igual que en el alta.
          const selectRuta = { priceCents: true, from: true, to: true, stops: true, bookingMode: true, currency: true } as const;
          const rutaDeLaReserva = reservation.routeId && (cambiaCantidad || cambiaEquipaje || cambiaMenores || cambiaSubida || cambiaBajada || pickup || pickupName !== undefined || movida)
            ? await tx.travelRoute.findUnique({ where: { id: reservation.routeId }, select: selectRuta })
            : null;
          // Si el cambio de servicio pasó la reserva a otra ruta (otra salida, otro sentido del
          // aeropuerto), la tarifa y las paradas salen de la ruta nueva.
          const rutaFinal = rutaNuevaId && rutaNuevaId !== reservation.routeId
            ? await tx.travelRoute.findUnique({ where: { id: rutaNuevaId }, select: selectRuta })
            : rutaDeLaReserva;
          let subidaFinal = subidaNueva === undefined ? reservation.boardingStop ?? null : subidaNueva;
          let bajadaFinal = bajadaNueva === undefined ? reservation.dropoffStop ?? null : bajadaNueva;
          if (!rutaFinal && (cambiaSubida || cambiaBajada)) {
            throw new BookingError("STOP_NOT_AVAILABLE", "No se pudo verificar el tramo de la reserva.");
          }
          if (rutaFinal && segmentPrice(rutaFinal, subidaFinal, bajadaFinal) === undefined) {
            if (cambiaSubida || cambiaBajada) {
              throw new BookingError("STOP_NOT_AVAILABLE", "Las paradas elegidas no tienen tarifa en ese sentido.");
            }
            if (rutaFinal !== rutaDeLaReserva) {
              subidaFinal = null;
              bajadaFinal = null;
            }
          }
          const cambiaOrigen = subidaFinal !== (reservation.boardingStop ?? null);
          const cambiaDestino = bajadaFinal !== (reservation.dropoffStop ?? null);
          if (cambiaOrigen || cambiaDestino) {
            await tx.reservation.update({ where: { id }, data: {
              ...(cambiaOrigen && { boardingStop: subidaFinal }),
              ...(cambiaDestino && { dropoffStop: bajadaFinal })
            } });
          }

          // Recargo por zona: si el punto del traslado se mueve, se cobra o se descuenta igual que
          // en el alta. Si ya lo tenía y sigue en la zona, queda el monto congelado al vender.
          const zonaAhora = reservation.airportDetails?.zoneExtraCents ?? 0;
          let zonaFinal = zonaAhora;
          if (reservation.bookingMode === "AIRPORT" && pickup?.point && status !== "CANCELLED") {
            const cobraZona = chargesZoneExtra(pickup.point, await getAirportCoverage(tx));
            if (!cobraZona) zonaFinal = 0;
            else if (zonaAhora === 0) zonaFinal = (await getAirportExtras(tx)).zoneExtraCents ?? 0;
          }
          const detalle = reservation.airportDetails;
          const unidadActual = detalle?.paihuenUnitCents ?? 0;
          let unidadFinal = unidadActual;
          if (detalle && reservation.currency === "ARS" && (pickup || pickupName !== undefined)) {
            const punto = pickup ? pickup.point : detalle.pickupLatitude != null && detalle.pickupLongitude != null
              ? [detalle.pickupLatitude, detalle.pickupLongitude] as [number, number] : null;
            const nombre = pickupName ?? (pickup && !pickup.point ? null : detalle.pickupName);
            unidadFinal = isPaihuen(nombre, pickup ? pickup.address : detalle.pickupAddress, punto) ? PAIHUEN_UNIT_CENTS : 0;
          }
          const cambiaPaihuen = unidadFinal !== unidadActual;
          if (cambiaPaihuen) await tx.airportReservationDetails.update({ where: { reservationId: id }, data: { paihuenUnitCents: unidadFinal } });
          const cambiaZona = zonaFinal !== zonaAhora;
          if (cambiaZona) {
            await tx.airportReservationDetails.update({ where: { reservationId: id }, data: { zoneExtraCents: zonaFinal } });
          }

          // Total de la reserva (#267): se recalcula con la tarifa y los adicionales que ya tiene la
          // reserva —no con la configuración de hoy— y no se pisa una corrección a mano. Un precio
          // escrito en este mismo formulario manda sobre la cuenta automática.
          const precioEscrito = financial !== undefined && (
            financial.operation === "price" || (financial.operation === "correctPayment" && financial.totalCents !== undefined)
          );
          if (!privada && !precioEscrito && (cambiaCantidad || cambiaEquipaje || cambiaMenores || cambiaSubida || cambiaBajada || cambiaZona || cambiaPaihuen || movida) && rutaDeLaReserva && rutaFinal) {
            const total = totalAlEditar({
              basis: {
                priceCents: tarifaPorPersona(rutaDeLaReserva, reservation.dropoffStop, reservation.boardingStop),
                passengerCount: reservation.passengerCount,
                halfFareCount: mediasAhora,
                freeFareCount: sinCargoAhora,
                paihuenUnitCents: unidadActual,
                zoneExtraCents: zonaAhora,
                sportsLuggageCount: reservation.airportDetails?.sportsLuggageCount ?? 0,
                sportsLuggageUnitCents: reservation.airportDetails?.sportsLuggageUnitCents ?? 0
              },
              totalCents: reservation.totalCents,
              passengerCount,
              sportsLuggageCount,
              halfFareCount: mediasFinal,
              freeFareCount: sinCargoFinal,
              paihuenUnitCents: unidadFinal,
              zoneExtraCents: zonaFinal,
              priceCents: tarifaPorPersona(rutaFinal, bajadaFinal, subidaFinal)
            });
            if (total.seRecalcula && total.totalCents !== reservation.totalCents) {
              // Con un comprobante por revisar no se mueve la plata: es la misma guarda que ya
              // protege el precio a mano. Primero se resuelve el pago y después se corrige.
              if (payment?.status === "PENDING" && payment.receiptBlobPathname) {
                throw new BookingError("PAYMENT_LOCKED", "Hay un comprobante por revisar: resolvé el pago antes de cambiar datos que mueven el total.");
              }
              // Con plata cobrada, el monto del pago no se mueve sin que el operador haya visto la
              // diferencia: el formulario se la muestra y manda esta confirmación.
              if (payment?.status === "APPROVED" && command.acknowledgeTotalChange !== true) {
                throw new BookingError("PAYMENT_LOCKED", "El pago ya está aprobado: confirmá la diferencia del total antes de guardar.");
              }
              await tx.reservation.update({ where: { id }, data: { totalCents: total.totalCents } });
              if (payment) await tx.payment.update({ where: { reservationId: id }, data: { amountCents: total.totalCents } });
            }
          }
          // El origen de la venta no es logística: se puede corregir incluso con la reserva
          // cancelada, y vacío borra el dato (#109).
          if (referredBy !== undefined) {
            await tx.reservation.update({ where: { id }, data: { referredBy: referredBy || null } });
          }
          if (pickup || notes !== undefined || pickupName !== undefined) {
            if (status === "CANCELLED") throw new BookingError("RESERVATION_LOCKED", "La reserva está cancelada.");
            const where = { reservationId: id };
            const notesData = notes === undefined ? {} : { pickupNotes: notes || null };
            // El nombre del lugar (hotel, cabaña) se escribe a mano y manda sobre el que se borra al
            // cargar un domicilio sin punto. En Chapelco la columna no admite vacío.
            const airportName = pickupName === undefined ? {} : { pickupName: pickupName || null };
            const chapelcoName = pickupName === undefined ? {} : { pickupName: pickupName || "Domicilio" };
            const addressData = pickup && {
              pickupAddress: pickup.address,
              // Sin punto (#268) las coordenadas quedan en null: no se inventan.
              pickupLatitude: pickup.point ? pickup.point[0] : null,
              pickupLongitude: pickup.point ? pickup.point[1] : null,
              // Un domicilio escrito a mano no tiene nombre de lugar: si quedara el anterior, la
              // orden del chofer imprimiría «Hotel viejo · Hostal del Esquiador».
              ...(pickup.point || pickupName !== undefined ? {} : { pickupName: null })
            };

            if (reservation.bookingMode === "AIRPORT") {
              if (pickup) {
                if (pickup.address.length > 160) {
                  throw new BookingError("INVALID_PICKUP_ADDRESS", "La dirección puede tener hasta 160 caracteres.");
                }
                // La zona sólo se puede validar con un punto. Sin coordenadas el domicilio se guarda
                // igual —el alojamiento cargado como texto (#268)— y el cálculo de zona no aplica.
                if (pickup.point) {
                  const coverage = await getAirportCoverage(tx);
                  if (coverage.enabled && !isInsideAirportPickupZone(pickup.point, coverage)) {
                    throw new BookingError("OUTSIDE_PICKUP_ZONE", OUTSIDE_PICKUP_ZONE);
                  }
                }
              }
              await tx.airportReservationDetails.update({
                where, data: { ...notesData, ...(addressData && { ...addressData, pickupAddress: addressData.pickupAddress || null }), ...airportName }
              });
            } else if (reservation.bookingMode === "CHAPELCO") {
              if (pickup) {
                const { address, point } = pickup;
                // Las columnas del traslado de Chapelco no admiten nulos: ahí el punto sigue siendo obligatorio.
                if (!point) {
                  throw new BookingError("INVALID_PICKUP_POINT", "Marcá el punto del traslado en el mapa.");
                }
                if (address.length < 4) {
                  throw new BookingError("INVALID_PICKUP_ADDRESS", "Ingresá una dirección para el traslado.");
                }
                const chapelcoData = { pickupAddress: address, pickupLatitude: point[0], pickupLongitude: point[1], ...chapelcoName };
                await tx.chapelcoReservationDetails.update({ where, data: { ...notesData, ...chapelcoData } });
                await tx.chapelcoManifestStop.updateMany({ where: { ...where, status: "PENDING" }, data: chapelcoData });
              } else {
                await tx.chapelcoReservationDetails.update({ where, data: { ...notesData, ...chapelcoName } });
                // La planilla del chofer guarda su copia del nombre del lugar.
                if (pickupName !== undefined) {
                  await tx.chapelcoManifestStop.updateMany({ where: { ...where, status: "PENDING" }, data: chapelcoName });
                }
              }
            } else {
              throw new BookingError("RESERVATION_LOCKED", "Esta reserva no tiene datos de traslado.");
            }
          }

          if (Object.keys(passenger).length > 0) {
            const where = { id: reservation.passengerId };
            const data = { ...passenger };
            // El documento es obligatorio (#122) salvo en el aeropuerto: se valida siempre el valor que va a quedar guardado,
            // aunque el operador esté tocando otro dato. Si la reserva vieja no tenía DNI, el guardado
            // lo pide en vez de arrastrar el hueco a la planilla del chofer.
            const saved = await tx.passenger.findUniqueOrThrow({ where, select: { documentType: true, documentId: true } });
            const documentType = data.documentType ?? saved.documentType;
            const documentId = data.documentId ?? saved.documentId;
            // El aeropuerto se reserva sin documento (#206, #208): ahí puede seguir vacío al editar.
            const error = passengerDocumentError(documentType, documentId, reservation.bookingMode === "AIRPORT");
            if (error) throw new BookingError("INVALID_PASSENGER_DOCUMENT", error);
            const normalizedId = normalizePassengerDocument(documentType, documentId);
            if (data.documentId !== undefined || normalizedId !== saved.documentId) data.documentId = normalizedId;
            await tx.passenger.update({ where, data });
          }
          break;
        }
      }

      // Sólo lo que cambió de verdad: una operación que no movió nada (cancelar una reserva ya
      // cancelada) no deja fila.
      const changes = diffRecords(before, reservationAuditSnapshot(
        await tx.reservation.findUnique({ where: { id }, include: reservationAuditInclude })
      ));
      if (hasChanges(changes)) await recordAudit(tx, { ...audit, changes });

      return { receiptPath: null };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") {
      throw new BookingError("BOOKING_BUSY", "Otro operador modificó esta reserva. Revisá el estado e intentalo de nuevo.");
    }
    throw error;
  }
}
