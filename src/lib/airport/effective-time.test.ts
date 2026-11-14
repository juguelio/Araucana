import { describe, expect, it } from "vitest";
import { corrioElHorario, horaEfectivaDelVuelo } from "./effective-time";

const vuelo = (scheduled: string, estimated?: string | null) => ({
  scheduledAt: new Date(scheduled),
  estimatedAt: estimated ? new Date(estimated) : null
});

/**
 * Issue #140: un vuelo demorado convivía con tres horas distintas —el corte de venta con la
 * estimada, la planilla con la programada y el operador con la coordinada—. Esta es la única cuenta
 * de «la hora del vuelo»; cualquier vista que la muestre tiene que pasar por acá.
 */
describe("hora efectiva del vuelo", () => {
  it("sin estimada manda la programada", () => {
    expect(horaEfectivaDelVuelo(vuelo("2026-11-12T18:15:00Z")).toISOString()).toBe("2026-11-12T18:15:00.000Z");
  });

  it("con demora manda la estimada", () => {
    const demorado = vuelo("2026-11-12T18:15:00Z", "2026-11-12T20:15:00Z");
    expect(horaEfectivaDelVuelo(demorado).toISOString()).toBe("2026-11-12T20:15:00.000Z");
    expect(corrioElHorario(demorado)).toBe(true);
  });

  it("con adelanto también: el avión sale antes y la recorrida se adelanta", () => {
    const adelantado = vuelo("2026-11-12T18:15:00Z", "2026-11-12T17:45:00Z");
    expect(horaEfectivaDelVuelo(adelantado).toISOString()).toBe("2026-11-12T17:45:00.000Z");
  });

  it("un vuelo en horario no se marca como corrido", () => {
    expect(corrioElHorario(vuelo("2026-11-12T18:15:00Z", "2026-11-12T18:15:00Z"))).toBe(false);
    expect(corrioElHorario(vuelo("2026-11-12T18:15:00Z"))).toBe(false);
  });
});
