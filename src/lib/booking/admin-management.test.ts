import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  reservation: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
  payment: { upsert: vi.fn(), update: vi.fn() },
  passenger: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  airportReservationDetails: { update: vi.fn(), findUnique: vi.fn() },
  chapelcoReservationDetails: { update: vi.fn(), findUnique: vi.fn() },
  chapelcoManifestStop: { deleteMany: vi.fn(), updateMany: vi.fn() },
  schedule: { findUnique: vi.fn() },
  vehicle: { findMany: vi.fn() }
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
