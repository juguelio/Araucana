import { describe, expect, it } from "vitest";
import { detectFlightChange, needsAttention, shiftMinutes, statusDetail } from "./flights";

const t = (hhmm: string) => new Date(`2026-10-20T${hhmm}:00.000Z`);
const vuelo = (status: string, est: string | null) => ({
  status,
  scheduledAt: t("12:00"),
  estimatedAt: est ? t(est) : null
});

describe("vuelos del aeropuerto", () => {
  it("no avisa nada si el vuelo no cambió", () => {
    expect(detectFlightChange(vuelo("SCHEDULED", "12:00"), vuelo("SCHEDULED", "12:00"))).toBeNull();
    expect(detectFlightChange(vuelo("SCHEDULED", null), vuelo("SCHEDULED", null))).toBeNull();
  });

  it("detecta la cancelación y el desvío", () => {
    expect(detectFlightChange(vuelo("SCHEDULED", "12:00"), vuelo("CANCELLED", null))?.kind).toBe("CANCEL");
    expect(detectFlightChange(vuelo("SCHEDULED", "12:00"), vuelo("DIVERTED", null))?.kind).toBe("DIVERSION");
  });

  it("demora: avisa recién cuando pasa el umbral (30 min)", () => {
    expect(detectFlightChange(vuelo("SCHEDULED", "12:00"), vuelo("SCHEDULED", "12:20"))).toBeNull();
    const cambio = detectFlightChange(vuelo("SCHEDULED", "12:00"), vuelo("SCHEDULED", "12:40"));
    expect(cambio?.kind).toBe("DELAY");
    expect(cambio?.toValue).toBe("09:40");   // 12:40Z = 09:40 en -03
  });

  it("no re-avisa si la demora se mantiene igual", () => {
    expect(detectFlightChange(vuelo("DELAYED", "12:40"), vuelo("DELAYED", "12:40"))).toBeNull();
  });

  it("adelanto mayor a 15 min avisa; menor no", () => {
    expect(detectFlightChange(vuelo("SCHEDULED", "12:00"), vuelo("SCHEDULED", "11:50"))).toBeNull();
    expect(detectFlightChange(vuelo("SCHEDULED", "12:00"), vuelo("SCHEDULED", "11:40"))?.kind).toBe("EARLY");
  });

  it("calcula el corrimiento y el texto del panel", () => {
    expect(shiftMinutes(vuelo("SCHEDULED", "12:45"))).toBe(45);
    expect(statusDetail(vuelo("SCHEDULED", "12:45"))).toBe("Demorado 45 min");
    expect(statusDetail(vuelo("SCHEDULED", "12:10"))).toBe("En horario");
    expect(statusDetail(vuelo("CANCELLED", null))).toBe("Cancelado");
  });

  it("marca lo que hay que mirar (demora >= 30 o cancelado/desviado)", () => {
    expect(needsAttention(vuelo("SCHEDULED", "12:40"))).toBe(true);
    expect(needsAttention(vuelo("CANCELLED", null))).toBe(true);
    expect(needsAttention(vuelo("SCHEDULED", "12:15"))).toBe(false);
  });
});
