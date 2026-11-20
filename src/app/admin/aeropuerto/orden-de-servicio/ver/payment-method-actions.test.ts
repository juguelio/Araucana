import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn(), upsert: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ getCurrentReservationsUserOrRedirect: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/prisma", () => {
  const tx = { reservation: { findFirst: mocks.find }, payment: { upsert: mocks.upsert }, auditLog: { create: mocks.audit } };
  return { prisma: { ...tx, $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx) } };
});

import { guardarFormaDePagoAction } from "./payment-method-actions";

const input = { date: "2031-03-14", code: "ARA-123", method: "Efectivo" as const };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ id: "secre", role: "SECRETARY" });
  mocks.find.mockResolvedValue({ id: "r1", totalCents: 123456, currency: "ARS", payment: null });
});

describe("forma de pago desde la orden", () => {
  it("anota el efectivo pendiente sin aprobar el pago ni modificar la reserva", async () => {
    expect(await guardarFormaDePagoAction(input)).toEqual({ ok: "Forma de pago guardada." });
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { reservationId: "r1" }, update: { method: "Efectivo" },
      create: { reservationId: "r1", provider: "MANUAL", status: "PENDING", amountCents: 123456, currency: "ARS", method: "Efectivo" }
    });
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: {
      code: input.code, bookingMode: "AIRPORT", status: { not: "CANCELLED" },
      airportDetails: { is: { serviceDate: { gte: expect.any(Date), lt: expect.any(Date) } } }
    } }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      actorId: "secre", entityId: "r1", changes: { "payment.method": { before: null, after: "Efectivo" } }
    }) }));
  });

  it("en un pago existente cambia sólo el método y conserva importes, comprobante y estado", async () => {
    mocks.find.mockResolvedValue({ id: "r1", totalCents: 123456, currency: "ARS", payment: { provider: "MANUAL", method: "Efectivo", status: "APPROVED" } });
    await guardarFormaDePagoAction({ ...input, method: "Transferencia" });
    expect(mocks.upsert.mock.calls[0][0].update).toEqual({ method: "Transferencia" });
  });

  it("permite borrar el método sin borrar el pago", async () => {
    mocks.find.mockResolvedValue({ id: "r1", totalCents: 123456, currency: "ARS", payment: { provider: "MANUAL", method: "Efectivo" } });
    await guardarFormaDePagoAction({ ...input, method: "" });
    expect(mocks.upsert.mock.calls[0][0].update).toEqual({ method: null });
  });

  it("no crea un pago cuando se deja sin indicar", async () => {
    await guardarFormaDePagoAction({ ...input, method: "" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rechaza reservas ajenas al día o canceladas", async () => {
    mocks.find.mockResolvedValue(null);
    expect(await guardarFormaDePagoAction(input)).toHaveProperty("error");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it.each([0, 1000])("no registra métodos en reservas sin cargo o de documentación (%i)", async (totalCents) => {
    mocks.find.mockResolvedValue({ id: "r1", totalCents, currency: "ARS", payment: totalCents ? { provider: "DISABILITY_DOCUMENT", method: null } : null });
    expect(await guardarFormaDePagoAction(input)).toHaveProperty("error");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("valida método y fecha antes de buscar la reserva", async () => {
    expect(await guardarFormaDePagoAction({ ...input, method: "tarjeta" } as unknown as typeof input)).toHaveProperty("error");
    expect(await guardarFormaDePagoAction({ ...input, date: "2031-02-30" })).toHaveProperty("error");
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it("exige una sesión del personal de reservas antes de leer o escribir", async () => {
    mocks.auth.mockRejectedValue(new Error("No autorizado"));
    await expect(guardarFormaDePagoAction(input)).rejects.toThrow("No autorizado");
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
