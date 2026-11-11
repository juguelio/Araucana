import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  reservation: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  payment: { upsert: vi.fn(), update: vi.fn() },
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

  it("cancela una reserva pagada, libera el asiento y conserva el pago", async () => {
    tx.reservation.findUnique.mockResolvedValue({ ...pending, payment: { ...pending.payment, status: "APPROVED" } });
    await expect(manageReservation(code, { operation: "delete" })).rejects.toMatchObject({ code: "PAYMENT_LOCKED" });
    await manageReservation(code, { operation: "cancel" });
    expect(tx.reservation.delete).not.toHaveBeenCalled();
    expect(tx.payment.upsert).not.toHaveBeenCalled();
    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: pending.id },
      data: { status: "CANCELLED", seatId: null, seatNumber: null }
    });
  });

  it("mantiene la revisión de documentación separada del cobro manual", async () => {
    tx.reservation.findUnique.mockResolvedValue({
      ...pending, status: "DOCUMENTATION_PENDING", payment: { status: "PENDING", provider: "DISABILITY_DOCUMENT" }
    });
    await expect(manageReservation(code, { operation: "payment", reference: "" })).rejects.toMatchObject({ code: "PAYMENT_LOCKED" });
    await expect(manageReservation(code, { operation: "confirm" })).rejects.toMatchObject({ code: "RESERVATION_LOCKED" });
  });
});

describe("edición de dirección de traslado", () => {
  const command = reservationManagementSchema.parse({
    operation: "address", address: "Av. San Martín y Belgrano", point: [-40.1565, -71.3497]
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
