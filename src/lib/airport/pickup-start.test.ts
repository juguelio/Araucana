import { describe, expect, it } from "vitest";
import { AIRPORT_PICKUP_LEAD_MINUTES, airportPickupStart } from "./pickup-start";

const partida = (extra: Partial<{ pickupStartOverrideAt: Date | null; status: string; direction: string }> = {}) => ({
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

  it("no inventa recorrida para llegadas, cancelados ni desviados", () => {
    expect(airportPickupStart(partida({ direction: "ARRIVAL" }))).toBeNull();
    expect(airportPickupStart(partida({ status: "CANCELLED" }))).toBeNull();
    expect(airportPickupStart(partida({ status: "DIVERTED" }))).toBeNull();
  });

  it("un vuelo de primera hora no cambia de día: sólo resta minutos", () => {
    const inicio = airportPickupStart({ direction: "DEPARTURE", scheduledAt: new Date("2026-11-13T11:00:00Z") })!;
    expect(inicio.toISOString()).toBe("2026-11-13T08:30:00.000Z");
  });
});
