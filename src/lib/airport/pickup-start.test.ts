import { describe, expect, it } from "vitest";
import { AIRPORT_PICKUP_LEAD_MINUTES, airportPickupStart } from "./pickup-start";

const partida = (
  extra: Partial<{ pickupStartOverrideAt: Date | null; estimatedAt: Date | null; status: string; direction: string }> = {}
) => ({
  direction: "DEPARTURE",
  // 15:45 en Salta = 18:45Z.
  scheduledAt: new Date("2026-11-12T18:45:00Z"),
  ...extra
});

describe("inicio de la recorrida del aeropuerto", () => {
  it("arranca dos horas y media antes del vuelo", () => {
    const inicio = airportPickupStart(partida())!;
    expect(AIRPORT_PICKUP_LEAD_MINUTES).toBe(150);
    // 16:15 en Salta = 19:15Z.
    expect(inicio.toISOString()).toBe("2026-11-12T16:15:00.000Z");
  });

  it("respeta la hora coordinada a mano por el operador", () => {
    const coordinada = new Date("2026-11-12T15:30:00Z");
    expect(airportPickupStart(partida({ pickupStartOverrideAt: coordinada }))).toBe(coordinada);
  });

  it("acompaña la hora efectiva: la demora y el adelanto mueven la recorrida", () => {
    // Con demora, la recorrida se corre con la estimada (issue #140).
    const delayed = { ...partida(), estimatedAt: new Date("2026-11-12T20:45:00Z") };
    expect(airportPickupStart(delayed)?.toISOString()).toBe("2026-11-12T18:15:00.000Z");
    // Con adelanto también: el avión sale antes y el chofer no puede salir a la hora vieja.
    const adelantado = { ...partida(), estimatedAt: new Date("2026-11-12T17:45:00Z") };
    expect(airportPickupStart(adelantado)?.toISOString()).toBe("2026-11-12T15:15:00.000Z");
    // La hora coordinada a mano manda sobre las dos.
    const override = new Date("2026-11-12T15:00:00Z");
    expect(airportPickupStart({ ...delayed, pickupStartOverrideAt: override })).toBe(override);
  });

  it("no inventa recorrida para llegadas, cancelados ni desviados", () => {
    expect(airportPickupStart(partida({ direction: "ARRIVAL" }))).toBeNull();
    expect(airportPickupStart(partida({ status: "CANCELLED" }))).toBeNull();
    expect(airportPickupStart(partida({ status: "DIVERTED" }))).toBeNull();
  });

  it("un vuelo de primera hora no cambia de día: sólo resta minutos", () => {
    const inicio = airportPickupStart({ direction: "DEPARTURE", scheduledAt: new Date("2026-11-13T11:00:00Z") })!;
    expect(inicio.toISOString()).toBe("2026-11-13T08:30:00.000Z");
  });

  /**
   * Issue #140: el corte de venta ya corría con la estimada, pero la recorrida que mostraban el
   * panel, la orden de servicio y la planilla seguía calculándose con la programada — el chofer
   * salía a buscar pasajeros de un vuelo que todavía no había salido.
   */
  it("con demora la recorrida se corre con la hora estimada", () => {
    // Estimado 18:45 en Salta = 21:45Z → la recorrida arranca 16:15 (19:15Z).
    const demorado = partida({ estimatedAt: new Date("2026-11-12T21:45:00Z") });
    expect(airportPickupStart(demorado)!.toISOString()).toBe("2026-11-12T19:15:00.000Z");
  });

  it("la hora coordinada a mano manda sobre la demora", () => {
    const coordinada = new Date("2026-11-12T16:00:00Z");
    const vuelo = partida({ estimatedAt: new Date("2026-11-12T21:45:00Z"), pickupStartOverrideAt: coordinada });
    expect(airportPickupStart(vuelo)).toBe(coordinada);
  });

  it("un adelanto informado también adelanta la recorrida", () => {
    // Estimado 15:15 en Salta = 18:15Z → recorrida 12:45 (15:45Z).
    const adelantado = partida({ estimatedAt: new Date("2026-11-12T18:15:00Z") });
    expect(airportPickupStart(adelantado)!.toISOString()).toBe("2026-11-12T15:45:00.000Z");
  });
});
