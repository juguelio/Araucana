import { describe, expect, it } from "vitest";
import { formatServiceDay, passengerFullName } from "./types";

describe("fecha del viaje en la planilla", () => {
  it("muestra el día del servicio, no el anterior", () => {
    // `serviceDate` es un DATE guardado a las 00:00Z: con la zona argentina caería el 31 de enero.
    expect(formatServiceDay(new Date("2027-02-01T00:00:00.000Z"))).toBe("1 de febrero de 2027");
  });

  it("funciona con el 1.º de mes y con fin de año", () => {
    expect(formatServiceDay(new Date("2027-03-01T00:00:00.000Z"))).toBe("1 de marzo de 2027");
    expect(formatServiceDay(new Date("2027-01-01T00:00:00.000Z"))).toBe("1 de enero de 2027");
    expect(formatServiceDay(new Date("2026-12-31T00:00:00.000Z"))).toBe("31 de diciembre de 2026");
  });

  it("no inventa fecha si el viaje no tiene", () => {
    expect(formatServiceDay(null)).toBeNull();
    expect(formatServiceDay(undefined)).toBeNull();
  });
});

describe("nombre del pasajero", () => {
  it("va apellido primero", () => {
    expect(passengerFullName({ firstName: "Bruno", lastName: "Gómez" })).toBe("Gómez, Bruno");
  });
});
