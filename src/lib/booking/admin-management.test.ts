import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  reservation: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
  payment: { upsert: vi.fn(), update: vi.fn() },
  passenger: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  airportReservationDetails: { update: vi.fn(), findUnique: vi.fn() },
  chapelcoReservationDetails: { update: vi.fn(), findUnique: vi.fn() },
  chapelcoManifestStop: { deleteMany: vi.fn(), updateMany: vi.fn() },
  serviceTicket: { findUnique: vi.fn(), update: vi.fn() },
  schedule: { findUnique: vi.fn() },
  vehicle: { findMany: vi.fn() },
  travelRoute: { findUnique: vi.fn(), findFirst: vi.fn() },
  flight: { findUnique: vi.fn(), findMany: vi.fn() },
  auditLog: { create: vi.fn() }
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { $transaction: (run: (client: typeof tx) => unknown) => run(tx) }
}));

vi.mock("@/lib/airport/extras-settings", () => ({ getAirportExtras: async () => ({ arrivalCutoffMinutes: 20, departureCutoffMinutes: 0 }) }));

vi.mock("@/lib/airport/pickup-zone-settings", () => ({ getAirportCoverage: vi.fn() }));

import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { initialAirportCoverage } from "@/lib/airport/pickup-zone";
import { manageReservation, reservationManagementSchema } from "./admin-management";

const code = "ARC-2611-TEST";
const pending = {
  id: "reservation",
  passengerId: "passenger",
  status: "PENDING_PAYMENT",
  totalCents: 1200000,
  currency: "ARS",
  payment: { status: "PENDING", provider: "MANUAL" }
};

beforeEach(() => {
  vi.clearAllMocks();
  tx.reservation.findUnique.mockResolvedValue(pending);
  vi.mocked(getAirportCoverage).mockResolvedValue(initialAirportCoverage);
});

describe("administración de reservas", () => {
  it("registra el importe de la reserva sin confirmar el viaje", async () => {
    await manageReservation(code, { operation: "payment", reference: "Efectivo" });
    expect(tx.payment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { status: "APPROVED", amountCents: pending.totalCents, currency: "ARS", externalRef: "Efectivo" }
    }));
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it("actualiza juntos el total y el pago pendiente, y protege un comprobante por revisar", async () => {
    await manageReservation(code, { operation: "price", totalCents: 1000000 });
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { totalCents: 1000000 } });
    expect(tx.payment.update).toHaveBeenCalledWith({ where: { reservationId: pending.id }, data: { amountCents: 1000000 } });
    tx.reservation.findUnique.mockResolvedValue({
      ...pending, payment: { ...pending.payment, receiptBlobPathname: "receipt" }
    });
    await expect(manageReservation(code, { operation: "price", totalCents: 500000 })).rejects.toMatchObject({ code: "PAYMENT_LOCKED" });
    expect(tx.payment.update).toHaveBeenCalledTimes(1);
  });

  it("corrige el total, la forma de pago y la referencia de una reserva pagada", async () => {
    tx.reservation.findUnique.mockResolvedValue({
      ...pending,
      status: "CONFIRMED",
      payment: { ...pending.payment, status: "APPROVED", receiptBlobPathname: "receipt" }
    });
    const command = { operation: "correctPayment", totalCents: 1150000, method: "Transferencia", reference: "123" } as const;

    await manageReservation(code, command);

    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { totalCents: 1150000 } });
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { reservationId: pending.id },
      data: { amountCents: 1150000, method: "Transferencia", externalRef: "123" }
    });

    tx.reservation.findUnique.mockResolvedValue(pending);
    await expect(manageReservation(code, command)).rejects.toMatchObject({ code: "PAYMENT_LOCKED" });
    expect(tx.payment.update).toHaveBeenCalledTimes(1);
  });

  it("exige el pago antes de confirmar una reserva con cargo", async () => {
    await expect(manageReservation(code, { operation: "confirm" })).rejects.toMatchObject({ code: "RESERVATION_LOCKED" });
    tx.reservation.findUnique.mockResolvedValue({ ...pending, payment: { ...pending.payment, status: "APPROVED" } });
    await manageReservation(code, { operation: "confirm" });
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { status: "CONFIRMED" } });
  });

  it("cancela una reserva pagada, libera el asiento, guarda el motivo y conserva el pago", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, payment: { ...pending.payment, status: "APPROVED" } });
    await expect(manageReservation(code, { operation: "delete" })).rejects.toMatchObject({ code: "PAYMENT_LOCKED" });
    await manageReservation(code, { operation: "cancel", reason: "El pasajero avisó que no viaja" });
    expect(tx.reservation.delete).not.toHaveBeenCalled();
    expect(tx.payment.upsert).not.toHaveBeenCalled();
    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: pending.id },
      data: {
        status: "CANCELLED",
        seatId: null,
        seatNumber: null,
        cancellationReason: "El pasajero avisó que no viaja",
        cancelledAt: expect.any(Date),
        cancelledByName: null
      }
    });
  });

  it("anula el boleto numerado conservando su número y el motivo (#370)", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, bookingMode: "SEATED", shortCode: "2WGS-TTT7" });
    tx.serviceTicket.findUnique.mockResolvedValue({ id: "boleto-1", status: "EMITIDO" });
    await manageReservation(code, { operation: "cancel", reason: "El pasajero avisó que no viaja", cancelledBy: "Vale" });
    expect(tx.serviceTicket.update).toHaveBeenCalledWith({
      where: { id: "boleto-1" },
      data: expect.objectContaining({ status: "ANULADO", annulReason: "El pasajero avisó que no viaja", annulledByName: "Vale" })
    });
  });

  it("deja en la auditoría quién hizo la operación y sólo los campos que cambiaron", async () => {
    const actor = { id: "user-1", name: "Vale", email: "vale@example.com", role: "SECRETARY" };
    const before = { ...pending, shortCode: "2WGS-TTT7", status: "CONFIRMED", seatNumber: "04", passenger: { firstName: "Ana", lastName: "Paz" } };
    tx.reservation.findUnique
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce({ ...before, status: "CANCELLED", seatNumber: null, cancellationReason: "Se reprogramó", cancelledByName: "Vale" });
    await manageReservation(code, { operation: "cancel", reason: "Se reprogramó", cancelledBy: "Vale" }, actor);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: "user-1", actorName: "Vale", actorEmail: "vale@example.com", actorRole: "SECRETARY",
        action: "CANCEL", entity: "RESERVATION", entityId: pending.id, entityLabel: code,
        summary: "Reserva cancelada. Código corto 2WGS-TTT7.",
        changes: {
          status: { before: "CONFIRMED", after: "CANCELLED" },
          seatNumber: { before: "04", after: null },
          cancellationReason: { before: null, after: "Se reprogramó" },
          cancelledByName: { before: null, after: "Vale" }
        }
      })
    });
  });

  it("una operación que no cambia nada no deja fila, y un borrado deja la foto de lo borrado", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, status: "CANCELLED" });
    await manageReservation(code, { operation: "cancel", reason: "Ya estaba cancelada" });
    expect(tx.auditLog.create).not.toHaveBeenCalled();

    tx.reservation.findUnique.mockResolvedValue({ ...pending, passenger: { firstName: "Ana", lastName: "Paz" } });
    await manageReservation(code, { operation: "delete" }, { id: "admin-1", role: "ADMIN" });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: "admin-1", action: "DELETE", summary: "Reserva borrada (pasajero Ana Paz).",
        changes: expect.objectContaining({
          status: { before: "PENDING_PAYMENT", after: null },
          totalCents: { before: 1200000, after: null },
          "passenger.firstName": { before: "Ana", after: null }
        })
      })
    });
  });

  it("no borra una reserva con boleto numerado: el número emitido no se reutiliza (#381)", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, bookingMode: "SEATED", shortCode: "2WGS-TTT7" });
    tx.serviceTicket.findUnique.mockResolvedValue({ id: "boleto-3", displayNumber: "W003", status: "EMITIDO" });

    await expect(manageReservation(code, { operation: "delete" })).rejects.toMatchObject({
      code: "TICKET_LOCKED",
      message: expect.stringContaining("W003")
    });

    // Un boleto ya anulado tampoco se puede perder: su número sigue en la serie.
    tx.serviceTicket.findUnique.mockResolvedValue({ id: "boleto-3", displayNumber: "W003", status: "ANULADO" });
    await expect(manageReservation(code, { operation: "delete" })).rejects.toMatchObject({ code: "TICKET_LOCKED" });

    expect(tx.reservation.delete).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("borra una reserva del servicio público que todavía no emitió boleto", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, bookingMode: "SEATED", shortCode: "2WGS-TTT7" });
    tx.serviceTicket.findUnique.mockResolvedValue(null);
    await manageReservation(code, { operation: "delete" });
    expect(tx.reservation.delete).toHaveBeenCalledWith({ where: { id: pending.id } });
  });

  it("exige el motivo de la cancelación y registra quién la canceló (#108)", async () => {
    expect(reservationManagementSchema.safeParse({ operation: "cancel", reason: "  " }).success).toBe(false);
    expect(reservationManagementSchema.safeParse({ operation: "cancel" }).success).toBe(false);
    expect(reservationManagementSchema.parse({ operation: "cancel", reason: "  Se reprogramó  ", cancelledBy: "Vale" }))
      .toMatchObject({ operation: "cancel", reason: "Se reprogramó", cancelledBy: "Vale" });

    tx.reservation.findUnique.mockResolvedValue({ ...pending, status: "CONFIRMED" });
    await manageReservation(code, { operation: "cancel", reason: "Se reprogramó", cancelledBy: "Vale" });
    expect(tx.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cancellationReason: "Se reprogramó", cancelledByName: "Vale" })
    }));
  });

  it("mantiene la revisión de documentación separada del cobro manual", async () => {
    tx.reservation.findUnique.mockResolvedValue({
      ...pending, status: "DOCUMENTATION_PENDING", payment: { status: "PENDING", provider: "DISABILITY_DOCUMENT" }
    });
    await expect(manageReservation(code, { operation: "payment", reference: "" })).rejects.toMatchObject({ code: "PAYMENT_LOCKED" });
    await expect(manageReservation(code, { operation: "confirm" })).rejects.toMatchObject({ code: "RESERVATION_LOCKED" });
  });
});

describe("edición de datos de la reserva", () => {
  const command = reservationManagementSchema.parse({
    operation: "edit", passenger: {},
    pickup: { address: "Av. San Martín y Belgrano", point: [-40.1565, -71.3497] }
  });
  const data = { pickupAddress: "Av. San Martín y Belgrano", pickupLatitude: -40.1565, pickupLongitude: -71.3497 };
  const where = { reservationId: pending.id };

  it("guarda la dirección y las coordenadas de aeropuerto en una misma actualización", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, bookingMode: "AIRPORT", status: "CONFIRMED" });
    vi.mocked(getAirportCoverage).mockResolvedValue({ ...initialAirportCoverage, enabled: true });

    await manageReservation(code, command);

    expect(getAirportCoverage).toHaveBeenCalledWith(tx);
    expect(tx.airportReservationDetails.update).toHaveBeenCalledWith({ where, data });
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  /**
   * Issue #268: el nombre del alojamiento no está en ningún geocoder. Se guarda como texto, sin
   * coordenadas —el mismo camino que una dirección sin geometría— y la zona no se valida.
   */
  it("guarda el alojamiento como texto cuando no hay punto", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, bookingMode: "AIRPORT", status: "CONFIRMED" });
    // Con la cobertura prendida igual se guarda: sin punto no hay zona que validar.
    vi.mocked(getAirportCoverage).mockResolvedValue({ ...initialAirportCoverage, enabled: true });

    await manageReservation(code, {
      operation: "edit", passenger: {}, pickup: { address: "Hostal del Esquiador", point: null }
    });

    expect(tx.airportReservationDetails.update).toHaveBeenCalledWith({
      where,
      data: { pickupAddress: "Hostal del Esquiador", pickupLatitude: null, pickupLongitude: null, pickupName: null }
    });
    expect(getAirportCoverage).not.toHaveBeenCalled();
  });

  it("acepta el domicilio sin punto en el esquema y exige el texto cuando falta", () => {
    expect(reservationManagementSchema.parse({
      operation: "edit", passenger: {}, pickup: { address: "Hostal del Esquiador" }
    })).toMatchObject({ pickup: { address: "Hostal del Esquiador" } });
    expect(reservationManagementSchema.safeParse({
      operation: "edit", passenger: {}, pickup: { address: "  ", point: null }
    }).success).toBe(false);
  });

  it("no deja guardar un traslado de Chapelco sin punto", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, bookingMode: "CHAPELCO" });

    await expect(manageReservation(code, {
      operation: "edit", passenger: {}, pickup: { address: "Hostal del Esquiador", point: null }
    })).rejects.toMatchObject({ code: "INVALID_PICKUP_POINT" });
    expect(tx.chapelcoReservationDetails.update).not.toHaveBeenCalled();
  });

  it("guarda precio, pasajero, dirección y notas con una sola operación", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, bookingMode: "AIRPORT" });
    tx.passenger.findUniqueOrThrow.mockResolvedValue({ documentType: "DNI", documentId: "30111222" });
    const changes = reservationManagementSchema.parse({
      ...command, passenger: { lastName: "Pérez" }, notes: "Tocar timbre",
      financial: { operation: "price", totalCents: 1150000 }
    });

    await manageReservation(code, changes);

    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { totalCents: 1150000 } });
    expect(tx.payment.update).toHaveBeenCalledWith({ where, data: { amountCents: 1150000 } });
    expect(tx.airportReservationDetails.update).toHaveBeenCalledOnce();
    expect(tx.airportReservationDetails.update).toHaveBeenCalledWith({ where, data: { ...data, pickupNotes: "Tocar timbre" } });
    expect(tx.passenger.update).toHaveBeenCalledWith({ where: { id: pending.passengerId }, data: { lastName: "Pérez" } });
  });

  it("impide guardar un precio pendiente si se registró el pago antes de guardar", async () => {
    tx.reservation.findUnique.mockResolvedValue({
      ...pending, payment: { ...pending.payment, status: "APPROVED" }
    });
    await expect(manageReservation(code, {
      operation: "edit", passenger: { lastName: "Pérez" },
      financial: { operation: "price", totalCents: 1150000 }
    })).rejects.toMatchObject({ code: "PAYMENT_LOCKED" });
    expect(tx.passenger.update).not.toHaveBeenCalled();
  });

  it("corrige la referencia de un pago sin reescribir el importe", async () => {
    tx.reservation.findUnique.mockResolvedValue({
      ...pending, status: "CONFIRMED", payment: { ...pending.payment, status: "APPROVED" }
    });
    await manageReservation(code, {
      operation: "edit", passenger: {}, financial: { operation: "correctPayment", reference: "42" }
    });
    expect(tx.payment.update).toHaveBeenCalledWith({ where, data: { externalRef: "42" } });
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it("guarda y borra el origen de la venta sin tocar el resto de la reserva (#109)", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, bookingMode: "AIRPORT", status: "CONFIRMED" });

    await manageReservation(code, { operation: "edit", passenger: {}, referredBy: "Agencia Los Andes" });
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { referredBy: "Agencia Los Andes" } });
    expect(tx.airportReservationDetails.update).not.toHaveBeenCalled();

    // Vacío borra el dato: la columna del Excel vuelve a salir vacía en vez de quedar con el viejo.
    await manageReservation(code, { operation: "edit", passenger: {}, referredBy: "" });
    expect(tx.reservation.update).toHaveBeenLastCalledWith({ where: { id: pending.id }, data: { referredBy: null } });
  });

  it("una edición que no manda el origen no lo pisa", async () => {
    tx.passenger.findUniqueOrThrow.mockResolvedValue({ documentType: "DNI", documentId: "30111222" });
    await manageReservation(code, { operation: "edit", passenger: { lastName: "Pérez" } });
    expect(tx.reservation.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { referredBy: null } }));
  });

  it("guarda notas de una reserva anterior sin exigir dirección ni tocar el pasajero", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, bookingMode: "AIRPORT" });

    await manageReservation(code, { operation: "edit", passenger: {}, notes: "" });

    expect(tx.airportReservationDetails.update).toHaveBeenCalledWith({ where, data: { pickupNotes: null } });
    expect(getAirportCoverage).not.toHaveBeenCalled();
    expect(tx.passenger.update).not.toHaveBeenCalled();
  });

  it("valida un documento editado con el tipo que ya está guardado", async () => {
    tx.passenger.findUniqueOrThrow.mockResolvedValue({ documentType: "DNI", documentId: "" });
    await manageReservation(code, { operation: "edit", passenger: { documentId: "32.123.456" } });

    expect(tx.passenger.update).toHaveBeenCalledWith({
      where: { id: pending.passengerId }, data: { documentId: "32123456" }
    });
  });

  // Issue #122: el documento pasó a ser obligatorio. Una reserva vieja sin DNI ya no se puede guardar
  // dejándolo vacío: la planilla del chofer tiene que salir completa.
  it("no deja guardar el pasajero con el documento vacío", async () => {
    tx.passenger.findUniqueOrThrow.mockResolvedValue({ documentType: "DNI", documentId: "" });

    await expect(
      manageReservation(code, { operation: "edit", passenger: { documentId: "" } })
    ).rejects.toThrow("Ingresá un DNI de 7 u 8 dígitos.");
    expect(tx.passenger.update).not.toHaveBeenCalled();
  });

  it("rechaza un punto excluido y una reserva cancelada", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, bookingMode: "AIRPORT" });
    vi.mocked(getAirportCoverage).mockResolvedValue({
      ...initialAirportCoverage, enabled: true,
      exclusions: [[[-40.16, -71.35], [-40.15, -71.35], [-40.15, -71.34], [-40.16, -71.34]]]
    });
    await expect(manageReservation(code, command)).rejects.toMatchObject({ code: "OUTSIDE_PICKUP_ZONE" });

    tx.reservation.findUnique.mockResolvedValue({ ...pending, bookingMode: "AIRPORT", status: "CANCELLED" });
    await expect(manageReservation(code, command)).rejects.toMatchObject({ code: "RESERVATION_LOCKED" });
    expect(tx.airportReservationDetails.update).not.toHaveBeenCalled();
  });

  it("sincroniza la nueva dirección de Chapelco con las paradas pendientes", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, bookingMode: "CHAPELCO" });

    await manageReservation(code, command);

    expect(tx.chapelcoReservationDetails.update).toHaveBeenCalledWith({ where, data });
    expect(tx.chapelcoManifestStop.updateMany).toHaveBeenCalledWith({ where: { ...where, status: "PENDING" }, data });
    expect(getAirportCoverage).not.toHaveBeenCalled();
  });
});

describe("restitución de una reserva cancelada (#117)", () => {
  const cancelled = {
    ...pending,
    bookingMode: "SEATED",
    scheduleId: "schedule",
    routeId: "route",
    passengerCount: 2,
    status: "CANCELLED",
    seatId: null,
    seatNumber: null,
    cancelledAt: new Date("2026-11-13T10:00:00.000Z"),
    cancellationReason: "El pasajero avisó que no viaja",
    cancelledByName: "Vale"
  };
  const seats = [
    { id: "seat-1", vehicleId: "vehicle", number: "1", row: 1, column: 1 },
    { id: "seat-2", vehicleId: "vehicle", number: "2", row: 1, column: 2 },
    { id: "seat-3", vehicleId: "vehicle", number: "3", row: 2, column: 1 },
    { id: "seat-4", vehicleId: "vehicle", number: "4", row: 2, column: 2 }
  ];
  const schedule = (over: Record<string, unknown> = {}) => ({
    id: "schedule",
    status: "OPEN",
    departureAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    route: { isActive: true },
    vehicle: { isActive: true, seats },
    reservations: [{ id: "otra", status: "CONFIRMED", passengerCount: 1, seatId: "seat-1", seatNumber: "1" }],
    ...over
  });

  it("le da un asiento libre y la deja confirmada si estaba pagada", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...cancelled, payment: { status: "APPROVED", provider: "MANUAL" } });
    tx.schedule.findUnique.mockResolvedValue(schedule());

    await manageReservation(code, { operation: "restore", restoredBy: "Vale" });

    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: pending.id },
      data: { status: "CONFIRMED", seatId: "seat-2", seatNumber: "2", restoredAt: expect.any(Date), restoredByName: "Vale" }
    });
    // El historial de la cancelación no se pisa: sólo se agrega quién y cuándo restituyó.
    expect(tx.reservation.update.mock.calls[0][0].data).not.toHaveProperty("cancellationReason");
    expect(tx.reservation.update.mock.calls[0][0].data).not.toHaveProperty("cancelledAt");
    expect(tx.reservation.update.mock.calls[0][0].data).not.toHaveProperty("cancelledByName");
  });

  it("vuelve a pago pendiente cuando no había pago registrado", async () => {
    tx.reservation.findUnique.mockResolvedValue(cancelled);
    tx.schedule.findUnique.mockResolvedValue(schedule());

    await manageReservation(code, { operation: "restore" });

    expect(tx.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PENDING_PAYMENT", restoredByName: null })
    }));
  });

  it("rechaza restituir si la salida ya arrancó y no cambia nada", async () => {
    tx.reservation.findUnique.mockResolvedValue(cancelled);
    tx.schedule.findUnique.mockResolvedValue(schedule({ departureAt: new Date(Date.now() - 60_000) }));

    await expect(manageReservation(code, { operation: "restore" })).rejects.toMatchObject({ code: "SERVICE_ALREADY_STARTED" });
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it("rechaza restituir sin cupo en vez de sobrevender", async () => {
    tx.reservation.findUnique.mockResolvedValue(cancelled);
    tx.schedule.findUnique.mockResolvedValue(schedule({
      reservations: [
        { id: "otra", status: "CONFIRMED", passengerCount: 1, seatId: "seat-1", seatNumber: "1" },
        { id: "otra-2", status: "PENDING_PAYMENT", passengerCount: 1, seatId: "seat-2", seatNumber: "2" },
        { id: "otra-3", status: "CONFIRMED", passengerCount: 1, seatId: "seat-3", seatNumber: "3" }
      ]
    }));

    await expect(manageReservation(code, { operation: "restore" })).rejects.toMatchObject({ code: "CAPACITY_FULL" });
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it("no restituye una reserva que no está cancelada", async () => {
    await expect(manageReservation(code, { operation: "restore" })).rejects.toMatchObject({ code: "RESERVATION_NOT_CANCELLED" });
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it("rechaza un vuelo que ya salió", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...cancelled, bookingMode: "AIRPORT", scheduleId: null });
    tx.airportReservationDetails.findUnique.mockResolvedValue({
      direction: "DEPARTURE",
      serviceDate: new Date("2026-11-13T00:00:00.000Z"),
      flight: {
        status: "SCHEDULED",
        scheduledAt: new Date(Date.now() - 60_000),
        estimatedAt: null,
        reservations: [],
        assignments: []
      }
    });

    await expect(manageReservation(code, { operation: "restore" })).rejects.toMatchObject({ code: "SERVICE_ALREADY_STARTED" });
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it("restituye un vuelo futuro con cupo", async () => {
    tx.reservation.findUnique.mockResolvedValue({
      ...cancelled, bookingMode: "AIRPORT", scheduleId: null, payment: { status: "APPROVED", provider: "MANUAL" }
    });
    tx.airportReservationDetails.findUnique.mockResolvedValue({
      direction: "DEPARTURE",
      serviceDate: new Date(Date.now() + 86_400_000),
      flight: {
        status: "SCHEDULED",
        scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        estimatedAt: null,
        reservations: [{ reservation: { passengerCount: 1, status: "CONFIRMED" } }],
        assignments: []
      }
    });

    await manageReservation(code, { operation: "restore" });

    expect(tx.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CONFIRMED", seatId: null, seatNumber: null })
    }));
  });

  it("rechaza un servicio de Chapelco que ya pasó", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...cancelled, bookingMode: "CHAPELCO", scheduleId: null });
    tx.chapelcoReservationDetails.findUnique.mockResolvedValue({ serviceDate: new Date("2026-01-05T00:00:00.000Z"), ascentSlot: "08:30" });

    await expect(manageReservation(code, { operation: "restore" })).rejects.toMatchObject({ code: "SERVICE_ALREADY_STARTED" });
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it("acepta la operación en el schema con quién la restituyó", () => {
    expect(reservationManagementSchema.parse({ operation: "restore", restoredBy: "Vale" }))
      .toMatchObject({ operation: "restore", restoredBy: "Vale" });
  });
});


it("no restituye una salida cuando la recorrida ya arrancó", async () => {
  tx.reservation.findUnique.mockResolvedValue({ ...pending, status: "CANCELLED", bookingMode: "AIRPORT" });
  tx.airportReservationDetails.findUnique.mockResolvedValue({
    direction: "DEPARTURE", serviceDate: new Date(), flight: {
      direction: "DEPARTURE", status: "SCHEDULED", scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
      estimatedAt: null, reservations: [], assignments: []
    }
  });
  await expect(manageReservation(code, { operation: "restore" })).rejects.toMatchObject({ code: "SERVICE_ALREADY_STARTED" });
  expect(tx.reservation.update).not.toHaveBeenCalled();
});

describe("cantidad de pasajeros y adicionales en la edición (#267)", () => {
  const seats = [
    { id: "seat-1", vehicleId: "vehicle", number: "1", row: 1, column: 1 },
    { id: "seat-2", vehicleId: "vehicle", number: "2", row: 1, column: 2 },
    { id: "seat-3", vehicleId: "vehicle", number: "3", row: 2, column: 1 },
    { id: "seat-4", vehicleId: "vehicle", number: "4", row: 2, column: 2 }
  ];
  const seated = {
    ...pending,
    bookingMode: "SEATED",
    scheduleId: "schedule",
    routeId: "route",
    passengerCount: 1,
    halfFareCount: 0,
    freeFareCount: 0,
    totalCents: 100000
  };
  // Otra reserva viva ocupa un lugar de los cuatro: quedan tres.
  const salida = {
    id: "schedule",
    vehicle: { isActive: true, seats },
    extraUnits: [],
    reservations: [{ id: "otra", status: "CONFIRMED", passengerCount: 1 }]
  };
  const airport = {
    ...pending,
    bookingMode: "AIRPORT",
    passengerCount: 2,
    halfFareCount: 0,
    freeFareCount: 0,
    routeId: "route",
    totalCents: 140000,
    airportDetails: { flightId: null, sportsLuggageCount: 1, sportsLuggageUnitCents: 10000, zoneExtraCents: 20000 }
  };

  it("acepta los campos nuevos en el schema", () => {
    expect(reservationManagementSchema.parse({
      operation: "edit", passenger: {}, passengerCount: "3", sportsLuggageCount: "2", acknowledgeTotalChange: true
    })).toMatchObject({ passengerCount: 3, sportsLuggageCount: 2, acknowledgeTotalChange: true });
    expect(reservationManagementSchema.safeParse({ operation: "edit", passenger: {}, passengerCount: 0 }).success).toBe(false);
    expect(reservationManagementSchema.safeParse({ operation: "edit", passenger: {}, passengerCount: 61 }).success).toBe(false);
    expect(reservationManagementSchema.safeParse({ operation: "edit", passenger: {}, sportsLuggageCount: 25 }).success).toBe(false);
  });

  it("guarda la cantidad nueva y recalcula el total cuando salió del cálculo", async () => {
    tx.reservation.findUnique.mockResolvedValue(seated);
    tx.travelRoute.findUnique.mockResolvedValue({ priceCents: 100000 });
    tx.schedule.findUnique.mockResolvedValue(salida);

    await manageReservation(code, { operation: "edit", passenger: {}, passengerCount: 3 });

    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { passengerCount: 3 } });
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { totalCents: 300000 } });
    expect(tx.payment.update).toHaveBeenCalledWith({ where: { reservationId: pending.id }, data: { amountCents: 300000 } });
  });

  it("rechaza una cantidad que excede los lugares libres del servicio", async () => {
    tx.reservation.findUnique.mockResolvedValue(seated);
    tx.schedule.findUnique.mockResolvedValue(salida);

    await expect(manageReservation(code, { operation: "edit", passenger: {}, passengerCount: 4 }))
      .rejects.toMatchObject({ code: "CAPACITY_FULL", message: expect.stringContaining("quedan 3 lugares") });
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it("no deja editar la cantidad de una reserva cancelada", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...seated, status: "CANCELLED" });

    await expect(manageReservation(code, { operation: "edit", passenger: {}, passengerCount: 2 }))
      .rejects.toMatchObject({ code: "RESERVATION_LOCKED" });
    expect(tx.schedule.findUnique).not.toHaveBeenCalled();
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it("no baja la cantidad por debajo de los menores que ya están dentro", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...seated, passengerCount: 3, halfFareCount: 1, freeFareCount: 1 });

    await expect(manageReservation(code, { operation: "edit", passenger: {}, passengerCount: 2 }))
      .rejects.toMatchObject({ code: "INVALID_PASSENGER_COUNT" });
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it("la tarifa sin cargo por discapacidad sigue siendo de un solo pasajero", async () => {
    tx.reservation.findUnique.mockResolvedValue({
      ...seated, passengerCount: 1, payment: { status: "PENDING", provider: "DISABILITY_DOCUMENT" }
    });

    await expect(manageReservation(code, { operation: "edit", passenger: {}, passengerCount: 2 }))
      .rejects.toMatchObject({ code: "INVALID_PASSENGER_COUNT", message: expect.stringContaining("un solo pasajero") });
    expect(tx.schedule.findUnique).not.toHaveBeenCalled();
  });

  it("suma el equipaje deportivo con el precio unitario guardado y actualiza el pago pendiente", async () => {
    tx.reservation.findUnique.mockResolvedValue(airport);
    tx.travelRoute.findUnique.mockResolvedValue({ priceCents: 55000 });

    await manageReservation(code, { operation: "edit", passenger: {}, sportsLuggageCount: 2 });

    expect(tx.airportReservationDetails.update).toHaveBeenCalledWith({
      where: { reservationId: pending.id }, data: { sportsLuggageCount: 2 }
    });
    // 2 pasajeros × 55.000 + 20.000 de zona + 2 bultos × 10.000 = 150.000.
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { totalCents: 150000 } });
    expect(tx.payment.update).toHaveBeenCalledWith({ where: { reservationId: pending.id }, data: { amountCents: 150000 } });
  });

  it("no pisa una corrección manual del precio al cambiar el equipaje", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...airport, totalCents: 999999 });
    tx.travelRoute.findUnique.mockResolvedValue({ priceCents: 55000 });

    await manageReservation(code, { operation: "edit", passenger: {}, sportsLuggageCount: 2 });

    expect(tx.airportReservationDetails.update).toHaveBeenCalledWith({
      where: { reservationId: pending.id }, data: { sportsLuggageCount: 2 }
    });
    expect(tx.reservation.update).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it("con el pago aprobado exige confirmar la diferencia antes de mover el importe", async () => {
    const paid = { ...airport, status: "CONFIRMED", payment: { status: "APPROVED", provider: "MANUAL" } };
    tx.reservation.findUnique.mockResolvedValue(paid);
    tx.travelRoute.findUnique.mockResolvedValue({ priceCents: 55000 });

    await expect(manageReservation(code, { operation: "edit", passenger: {}, sportsLuggageCount: 3 }))
      .rejects.toMatchObject({ code: "PAYMENT_LOCKED", message: expect.stringContaining("diferencia") });
    expect(tx.reservation.update).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();

    await manageReservation(code, { operation: "edit", passenger: {}, sportsLuggageCount: 3, acknowledgeTotalChange: true });

    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { totalCents: 160000 } });
    expect(tx.payment.update).toHaveBeenCalledWith({ where: { reservationId: pending.id }, data: { amountCents: 160000 } });
  });

  it("sincroniza la cantidad con la planilla de Chapelco", async () => {
    const serviceDate = new Date("2026-12-01T00:00:00.000Z");
    tx.reservation.findUnique.mockResolvedValue({
      ...pending, bookingMode: "CHAPELCO", passengerCount: 2, halfFareCount: 0, freeFareCount: 0,
      routeId: "route", totalCents: 200000
    });
    tx.chapelcoReservationDetails.findUnique.mockResolvedValue({ ascentSlot: "08:30", serviceDate });
    tx.vehicle.findMany.mockResolvedValue([{ _count: { seats: 10 } }]);
    tx.reservation.findMany.mockResolvedValue([]);
    tx.travelRoute.findUnique.mockResolvedValue({ priceCents: 100000 });

    await manageReservation(code, { operation: "edit", passenger: {}, passengerCount: 3 });

    expect(tx.chapelcoManifestStop.updateMany).toHaveBeenCalledWith({
      where: { reservationId: pending.id, status: "PENDING" }, data: { passengerCount: 3 }
    });
  });

  it("un precio escrito en el formulario manda sobre la cuenta automática", async () => {
    tx.reservation.findUnique.mockResolvedValue(seated);
    tx.schedule.findUnique.mockResolvedValue(salida);

    await manageReservation(code, {
      operation: "edit", passenger: {}, passengerCount: 2,
      financial: { operation: "price", totalCents: 123456 }
    });

    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { passengerCount: 2 } });
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { totalCents: 123456 } });
    expect(tx.reservation.update).not.toHaveBeenCalledWith({ where: { id: pending.id }, data: { totalCents: 200000 } });
  });

  it("no mueve el importe mientras hay un comprobante por revisar", async () => {
    tx.reservation.findUnique.mockResolvedValue({
      ...airport,
      payment: { status: "PENDING", provider: "MANUAL", receiptBlobPathname: "receipts/1.pdf" }
    });
    tx.travelRoute.findUnique.mockResolvedValue({ priceCents: 55000 });

    await expect(manageReservation(code, { operation: "edit", passenger: {}, sportsLuggageCount: 2 }))
      .rejects.toMatchObject({ code: "PAYMENT_LOCKED", message: expect.stringContaining("comprobante") });
    expect(tx.reservation.update).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it("cambia los menores y recalcula el total; en el aeropuerto sincroniza la copia del detalle", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...seated, passengerCount: 3, totalCents: 300000 });
    tx.travelRoute.findUnique.mockResolvedValue({ priceCents: 100000, from: "A", to: "B", stops: [] });

    await manageReservation(code, { operation: "edit", passenger: {}, halfFareCount: 1, freeFareCount: 1 });

    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { halfFareCount: 1, freeFareCount: 1 } });
    // 1 adulto (100.000) + 1 media (50.000) + 1 sin cargo.
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { totalCents: 150000 } });
    // Los menores no ocupan lugares aparte: no se revisa el cupo.
    expect(tx.schedule.findUnique).not.toHaveBeenCalled();

    vi.clearAllMocks();
    tx.reservation.findUnique.mockResolvedValue(airport);
    tx.travelRoute.findUnique.mockResolvedValue({ priceCents: 55000 });
    await manageReservation(code, { operation: "edit", passenger: {}, halfFareCount: 1 });
    expect(tx.airportReservationDetails.update).toHaveBeenCalledWith({ where: { reservationId: pending.id }, data: { halfFareCount: 1 } });
  });

  it("no deja menores sin un adulto ni más menores que pasajeros", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...seated, passengerCount: 2 });

    await expect(manageReservation(code, { operation: "edit", passenger: {}, halfFareCount: 1, freeFareCount: 1 }))
      .rejects.toMatchObject({ code: "INVALID_PASSENGER_COUNT", message: expect.stringContaining("tarifa entera") });
    await expect(manageReservation(code, { operation: "edit", passenger: {}, halfFareCount: 3 }))
      .rejects.toMatchObject({ code: "INVALID_PASSENGER_COUNT", message: expect.stringContaining("no puede superar") });
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it("cambia la bajada a una parada con tarifa y recalcula con su precio", async () => {
    const ruta = { priceCents: 100000, from: "San Martín", to: "Bariloche", stops: [{ name: "Villa La Angostura", priceCents: 60000 }] };
    tx.reservation.findUnique.mockResolvedValue({ ...seated, passengerCount: 2, totalCents: 200000 });
    tx.travelRoute.findUnique.mockResolvedValue(ruta);

    await manageReservation(code, { operation: "edit", passenger: {}, dropoffStop: "Villa La Angostura" });
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { dropoffStop: "Villa La Angostura" } });
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { totalCents: 120000 } });

    // Volver al destino final usa la tarifa entera de la ruta.
    vi.clearAllMocks();
    tx.reservation.findUnique.mockResolvedValue({ ...seated, passengerCount: 2, totalCents: 120000, dropoffStop: "Villa La Angostura" });
    tx.travelRoute.findUnique.mockResolvedValue(ruta);
    await manageReservation(code, { operation: "edit", passenger: {}, dropoffStop: "" });
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { dropoffStop: null } });
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { totalCents: 200000 } });

    // Una parada que no está en la ruta se rechaza.
    vi.clearAllMocks();
    tx.reservation.findUnique.mockResolvedValue({ ...seated, passengerCount: 2, totalCents: 200000 });
    tx.travelRoute.findUnique.mockResolvedValue(ruta);
    await expect(manageReservation(code, { operation: "edit", passenger: {}, dropoffStop: "Junín" }))
      .rejects.toMatchObject({ code: "STOP_NOT_AVAILABLE" });
  });

  it("quita el recargo por zona cuando el punto sale de la zona con recargo", async () => {
    tx.reservation.findUnique.mockResolvedValue(airport);
    tx.travelRoute.findUnique.mockResolvedValue({ priceCents: 55000 });

    await manageReservation(code, { operation: "edit", passenger: {}, pickup: { address: "Centro", point: [-40.15, -71.35] } });

    expect(tx.airportReservationDetails.update).toHaveBeenCalledWith({ where: { reservationId: pending.id }, data: { zoneExtraCents: 0 } });
    // 2 × 55.000 + 1 bulto × 10.000, sin los 20.000 de zona.
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { totalCents: 120000 } });
  });

  it("edita el nombre del lugar del traslado y lo pasa a la planilla de Chapelco", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, bookingMode: "CHAPELCO" });

    await manageReservation(code, { operation: "edit", passenger: {}, pickupName: "Hostería del Lago" });

    expect(tx.chapelcoReservationDetails.update).toHaveBeenCalledWith({
      where: { reservationId: pending.id }, data: { pickupName: "Hostería del Lago" }
    });
    expect(tx.chapelcoManifestStop.updateMany).toHaveBeenCalledWith({
      where: { reservationId: pending.id, status: "PENDING" }, data: { pickupName: "Hostería del Lago" }
    });
  });

  it("no acepta equipaje deportivo en una reserva que no es del aeropuerto", async () => {
    tx.reservation.findUnique.mockResolvedValue(seated);

    await expect(manageReservation(code, { operation: "edit", passenger: {}, sportsLuggageCount: 1 }))
      .rejects.toMatchObject({ code: "RESERVATION_LOCKED" });
  });
});

describe("edición de cantidad en una recorrida compartida", () => {
  const futuro = new Date(Date.now() + 5 * 24 * 3600 * 1000);
  const asientos = Array.from({ length: 15 }, (_, i) => ({ id: `s${i}` }));
  const fila = (reservationId: string, passengerCount: number) => ({
    id: `vuelo-${reservationId}`,
    number: `AR${reservationId}`,
    pickupGroupId: "recorrida",
    direction: "ARRIVAL",
    status: "SCHEDULED",
    source: "MANUAL",
    scheduledAt: futuro,
    estimatedAt: null,
    reservations: [{ reservationId, reservation: { passengerCount, status: "CONFIRMED" } }],
    assignments: [{ vehicleId: "combi", vehicle: { seats: asientos } }]
  });

  it("deja bajar pasajeros aunque la recorrida ya esté sobrevendida", async () => {
    tx.reservation.findUnique.mockResolvedValue({
      ...pending,
      bookingMode: "AIRPORT",
      passengerCount: 12,
      halfFareCount: 0,
      freeFareCount: 0,
      routeId: "route",
      scheduleId: null,
      totalCents: 120000,
      airportDetails: {
        flightId: "vuelo-reservation",
        isPrivate: false,
        direction: "ARRIVAL",
        sportsLuggageCount: 0,
        sportsLuggageUnitCents: 0,
        zoneExtraCents: 0
      }
    });
    tx.airportReservationDetails.findUnique.mockResolvedValue({
      flightId: "vuelo-reservation",
      isPrivate: false,
      flight: fila("reservation", 12)
    });
    tx.flight.findMany.mockResolvedValue([fila("reservation", 12), fila("otra", 12)]);
    tx.travelRoute.findUnique.mockResolvedValue({ priceCents: 10000, from: "A", to: "B", stops: [] });

    await manageReservation(code, { operation: "edit", passenger: {}, passengerCount: 11 });

    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { passengerCount: 11 } });
  });
});

describe("pasar la reserva a otro servicio", () => {
  const futuro = new Date(Date.now() + 5 * 24 * 3600 * 1000);
  const seats = [
    { id: "s1", vehicleId: "v", number: "1", row: 1, column: 1 },
    { id: "s2", vehicleId: "v", number: "2", row: 1, column: 2 }
  ];
  const seated = {
    ...pending, bookingMode: "SEATED", scheduleId: "vieja", routeId: "route", passengerCount: 1,
    halfFareCount: 0, freeFareCount: 0, totalCents: 100000, dropoffStop: null
  };
  const salidaNueva = (reservas: Array<{ id: string; status: string; passengerCount: number; seatId: string | null; seatNumber: string | null }> = []) => ({
    id: "nueva", routeId: "route", status: "OPEN", departureAt: futuro,
    route: { isActive: true, bookingMode: "SEATED" }, vehicle: { isActive: true, seats }, extraUnits: [], reservations: reservas
  });

  it("pasa la reserva a otra salida con el primer asiento libre", async () => {
    tx.reservation.findUnique.mockResolvedValue(seated);
    tx.schedule.findUnique.mockResolvedValue(salidaNueva([{ id: "otra", status: "CONFIRMED", passengerCount: 1, seatId: "s1", seatNumber: "1" }]));
    tx.travelRoute.findUnique.mockResolvedValue({ priceCents: 100000, from: "A", to: "B", stops: [] });

    await manageReservation(code, { operation: "edit", passenger: {}, move: { mode: "SEATED", scheduleId: "nueva" } });

    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: pending.id }, data: { scheduleId: "nueva", routeId: "route", seatId: "s2", seatNumber: "2" }
    });
    // Misma ruta y misma tarifa: el total no cambia.
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it("mide el cupo de la salida nueva con la cantidad final", async () => {
    tx.reservation.findUnique.mockResolvedValue(seated);
    tx.schedule.findUnique.mockResolvedValue(salidaNueva([{ id: "otra", status: "CONFIRMED", passengerCount: 1, seatId: "s1", seatNumber: "1" }]));

    await expect(manageReservation(code, { operation: "edit", passenger: {}, passengerCount: 2, move: { mode: "SEATED", scheduleId: "nueva" } }))
      .rejects.toMatchObject({ code: "CAPACITY_FULL", message: expect.stringContaining("quedaría con 2") });
  });

  it("no pasa a una salida que ya arrancó, ni mueve una cancelada o a otro tipo de servicio", async () => {
    tx.reservation.findUnique.mockResolvedValue(seated);
    tx.schedule.findUnique.mockResolvedValue({ ...salidaNueva(), departureAt: new Date(Date.now() - 60_000) });
    await expect(manageReservation(code, { operation: "edit", passenger: {}, move: { mode: "SEATED", scheduleId: "nueva" } }))
      .rejects.toMatchObject({ code: "SERVICE_ALREADY_STARTED" });

    tx.reservation.findUnique.mockResolvedValue({ ...seated, status: "CANCELLED" });
    await expect(manageReservation(code, { operation: "edit", passenger: {}, move: { mode: "SEATED", scheduleId: "nueva" } }))
      .rejects.toMatchObject({ code: "RESERVATION_LOCKED" });

    tx.reservation.findUnique.mockResolvedValue(seated);
    await expect(manageReservation(code, { operation: "edit", passenger: {}, move: { mode: "AIRPORT", flightId: "f" } }))
      .rejects.toMatchObject({ code: "RESERVATION_LOCKED" });
  });

  it("pasa una reserva del aeropuerto a un vuelo del otro sentido con la tarifa de ese sentido", async () => {
    tx.reservation.findUnique.mockResolvedValue({
      ...pending, bookingMode: "AIRPORT", routeId: "ruta-arribo", passengerCount: 2, halfFareCount: 0, freeFareCount: 0, totalCents: 110000,
      airportDetails: { flightId: "f-viejo", direction: "ARRIVAL", sportsLuggageCount: 0, sportsLuggageUnitCents: 0, zoneExtraCents: 0 }
    });
    tx.flight.findUnique.mockResolvedValue({
      id: "f-nuevo", number: "AR1673", direction: "DEPARTURE", status: "SCHEDULED", scheduledAt: new Date("2026-12-10T22:30:00.000Z"),
      estimatedAt: null, actualAt: null, pickupStartOverrideAt: null, reservations: [], assignments: []
    });
    tx.travelRoute.findFirst.mockResolvedValue({ id: "ruta-salida" });
    tx.travelRoute.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "ruta-salida" ? { priceCents: 60000, from: "Hotel", to: "CPC", stops: [] } : { priceCents: 55000, from: "CPC", to: "Hotel", stops: [] });

    await manageReservation(code, { operation: "edit", passenger: {}, move: { mode: "AIRPORT", flightId: "f-nuevo" } });

    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { routeId: "ruta-salida" } });
    expect(tx.airportReservationDetails.update).toHaveBeenCalledWith({
      where: { reservationId: pending.id },
      data: {
        flightId: "f-nuevo", flightNumber: "AR1673", direction: "DEPARTURE",
        // 22:30 UTC del 10 es 19:30 del 10 en Argentina: el día del servicio es el 10.
        serviceDate: new Date("2026-12-10T03:00:00.000Z"),
        assignmentId: null, routePosition: null
      }
    });
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: pending.id }, data: { totalCents: 120000 } });
  });

  it("pasa una reserva de Chapelco a otro día y saca sus paradas pendientes", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, bookingMode: "CHAPELCO", routeId: "route", passengerCount: 2, halfFareCount: 0, freeFareCount: 0 });
    tx.chapelcoReservationDetails.findUnique.mockResolvedValue({ serviceDate: new Date("2026-12-01T00:00:00.000Z"), ascentSlot: "08:30" });
    tx.vehicle.findMany.mockResolvedValue([{ _count: { seats: 10 } }]);
    tx.reservation.findMany.mockResolvedValue([]);
    const dia = futuro.toISOString().slice(0, 10);

    await manageReservation(code, { operation: "edit", passenger: {}, move: { mode: "CHAPELCO", serviceDate: dia, ascentSlot: "10:30" } });

    expect(tx.chapelcoReservationDetails.update).toHaveBeenCalledWith({
      where: { reservationId: pending.id }, data: { serviceDate: new Date(`${dia}T00:00:00.000Z`), ascentSlot: "10:30" }
    });
    expect(tx.chapelcoManifestStop.deleteMany).toHaveBeenCalledWith({ where: { reservationId: pending.id, status: "PENDING" } });
  });
});
