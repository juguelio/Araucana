import { describe, expect, it } from "vitest";
import { createDepartureSheetToken, isDepartureSheetToken } from "./codes";

describe("token del link de planilla", () => {
  it("genera 128 bits con el prefijo de planilla", () => {
    const token = createDepartureSheetToken();

    expect(token).toMatch(/^PLN-[A-F0-9]{32}$/);
    expect(isDepartureSheetToken(token)).toBe(true);
  });

  it("no acepta identificadores adivinables ni códigos de reserva", () => {
    expect(isDepartureSheetToken("PLN-1")).toBe(false);
    expect(isDepartureSheetToken("planilla-2026")).toBe(false);
    expect(isDepartureSheetToken("ARC-2611-0123456789ABCDEF0123456789ABCDEF")).toBe(false);
  });

  it("no repite tokens entre llamadas", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createDepartureSheetToken()));

    expect(tokens.size).toBe(200);
  });
});
