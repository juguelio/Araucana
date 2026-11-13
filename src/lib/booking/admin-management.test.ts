import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  reservation: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  payment: { upsert: vi.fn(), update: vi.fn() },
  passenger: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  airportReservationDetails: { update: vi.fn() },
  chapelcoReservationDetails: { update: vi.fn() },
  chapelcoManifestStop: { deleteMany: vi.fn(), updateMany: vi.fn() }
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { $transaction: (run: (client: typeof tx) => unknown) => run(tx) }
}));

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
    expect(tx.passenger.findUniqueOrThrow).not.toHaveBeenCalled();
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
