import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    reservation: { findMany: m.findMany, updateMany: m.updateMany }
  }
}));

import { reconciliarReservasDeVuelosPasados } from "./reservation-cleanup";

/**
 * En la base del cliente había 14 reservas de aeropuerto impagas de vuelos que ya habían pasado, y
 * cuatro de ellas con el pago aprobado: plata cobrada, reserva sin confirmar.
 */
describe("reconciliarReservasDeVuelosPasados", () => {
  const ahora = new Date("2026-11-15T22:00:00Z");
  const hace3Dias = new Date("2026-11-12T12:00:00Z");
  const en3Dias = new Date("2026-11-18T12:00:00Z");

  const reserva = (id: string, pago: string, vuelo: Date | null) => ({
    id,
    payment: { status: pago },
    airportDetails: vuelo ? { flight: { scheduledAt: vuelo } } : null
  });

  beforeEach(() => {
    m.findMany.mockReset();
    m.updateMany.mockReset().mockResolvedValue({ count: 0 });
  });

  it("confirma la reserva cuando el pago está aprobado, aunque el vuelo ya haya pasado", async () => {
    m.findMany.mockResolvedValue([reserva("pagada", "APPROVED", hace3Dias)]);

    const r = await reconciliarReservasDeVuelosPasados(ahora);

    expect(r).toEqual({ confirmadas: 1, canceladas: 0 });
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["pagada"] } },
      data: { status: "CONFIRMED" }
    });
  });

  it("cancela la reserva impaga cuyo vuelo ya pasó", async () => {
    m.findMany.mockResolvedValue([reserva("impaga", "PENDING", hace3Dias)]);

    const r = await reconciliarReservasDeVuelosPasados(ahora);

    expect(r).toEqual({ confirmadas: 0, canceladas: 1 });
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["impaga"] } },
      data: { status: "CANCELLED" }
    });
  });

  it("no toca una reserva impaga de un vuelo futuro: es plata que se puede cobrar", async () => {
    m.findMany.mockResolvedValue([reserva("futura", "PENDING", en3Dias)]);

    const r = await reconciliarReservasDeVuelosPasados(ahora);

    expect(r).toEqual({ confirmadas: 0, canceladas: 0 });
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("no toca una reserva impaga dentro de las horas de gracia del vuelo", async () => {
    // El vuelo salió hace 3 horas: todavía puede estar en el aire o el pasajero pagando.
    const hace3Horas = new Date("2026-11-15T19:00:00Z");
    m.findMany.mockResolvedValue([reserva("enGracia", "PENDING", hace3Horas)]);

    const r = await reconciliarReservasDeVuelosPasados(ahora);

    expect(r).toEqual({ confirmadas: 0, canceladas: 0 });
  });

  it("ignora una reserva sin vuelo asociado", async () => {
    m.findMany.mockResolvedValue([reserva("suelta", "PENDING", null)]);

    const r = await reconciliarReservasDeVuelosPasados(ahora);

    expect(r).toEqual({ confirmadas: 0, canceladas: 0 });
  });
});
