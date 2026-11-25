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
    expect(inicio.toISOString()).toBe("2026-11-12T16:15:00.000Z");
  });

  it("respeta la hora coordinada a mano por el operador", () => {
    const coordinada = new Date("2026-11-12T15:30:00Z");
    expect(airportPickupStart(partida({ pickupStartOverrideAt: coordinada }))).toBe(coordinada);
  });

  it.each(["17:45", "20:45"])("una estimación de las %s conserva el inicio", (hora) => {
    const vuelo = partida({ estimatedAt: new Date(`2026-11-12T${hora}:00Z`) });
    expect(airportPickupStart(vuelo)).toEqual(new Date("2026-11-12T16:15:00Z"));
  });

  it("restaurar el horario inicial recupera la misma hora aun después de una reprogramación", () => {
    const inicial = new Date("2026-11-12T16:15:00Z");
    const manual = new Date("2026-11-12T15:00:00Z");
    const vuelo = { ...partida(), scheduledAt: new Date("2026-11-12T20:00:00Z"), pickupStartInitialAt: inicial };
    expect(airportPickupStart({ ...vuelo, pickupStartOverrideAt: manual })).toEqual(manual);
    expect(airportPickupStart({ ...vuelo, pickupStartOverrideAt: null })).toEqual(inicial);
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
