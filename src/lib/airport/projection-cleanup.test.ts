import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  delete: vi.fn(),
  airports: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    flight: { findMany: m.findMany, delete: m.delete },
    airportReservationDetails: { findMany: m.airports }
  }
}));

import { limpiarProyectadosQueYaNoCorresponden } from "./sync";

/**
 * La proyección sólo agregaba: cuando el patrón cambiaba, la fila vieja quedaba en la base. Se veía
 * en el tablero del 17/11 —5 arribos y 6 partidas— porque AR1655 estaba proyectado sin su AR1654.
 */
describe("limpiarProyectadosQueYaNoCorresponden", () => {
  beforeEach(() => {
    m.findMany.mockReset();
    m.delete.mockReset().mockResolvedValue({});
    m.airports.mockReset().mockResolvedValue([]);
  });

  it("borra el ESTIMADO que el patrón ya no genera", async () => {
    m.findMany.mockResolvedValue([
      { id: "huerfano", number: "AR1655", direction: "DEPARTURE" },
      { id: "vigente", number: "AR1659", direction: "DEPARTURE" }
    ]);

    const borrados = await limpiarProyectadosQueYaNoCorresponden("2026-11-17", [
      { number: "AR1659", direction: "DEPARTURE" } as never
    ]);

    expect(borrados).toBe(1);
    expect(m.delete).toHaveBeenCalledWith({ where: { id: "huerfano" } });
    expect(m.delete).not.toHaveBeenCalledWith({ where: { id: "vigente" } });
  });

  it("no borra un proyectado con reserva: lo resuelve una persona", async () => {
    m.findMany.mockResolvedValue([{ id: "conReserva", number: "AR1655", direction: "DEPARTURE" }]);
    m.airports.mockResolvedValue([{ flightId: "conReserva" }]);

    const borrados = await limpiarProyectadosQueYaNoCorresponden("2026-11-17", []);

    expect(borrados).toBe(0);
    expect(m.delete).not.toHaveBeenCalled();
  });

  it("no toca nada si todos los proyectados del día siguen vigentes", async () => {
    m.findMany.mockResolvedValue([{ id: "ok", number: "AR1659", direction: "DEPARTURE" }]);

    const borrados = await limpiarProyectadosQueYaNoCorresponden("2026-11-17", [
      { number: "AR1659", direction: "DEPARTURE" } as never
    ]);

    expect(borrados).toBe(0);
    expect(m.delete).not.toHaveBeenCalled();
  });
});
