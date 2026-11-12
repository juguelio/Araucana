import { describe, expect, it } from "vitest";
import {
  SHORT_CODE_LENGTH,
  createReservationCode,
  createReservationShortCode,
  formatShortCode,
  isPrivateReservationCode,
  isShortCode,
  normalizeShortCode
} from "./codes";

// El código corto (#75) se dicta por teléfono, se imprime en el comprobante y se busca en el panel.
describe("código corto de reserva", () => {
  it("tiene 8 caracteres y sólo del alfabeto sin ambigüedad (sin 0/O ni 1/I)", () => {
    for (let index = 0; index < 200; index += 1) {
      const code = createReservationShortCode();
      expect(code).toHaveLength(SHORT_CODE_LENGTH);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
      expect(code).not.toMatch(/[01OI]/);
      expect(isShortCode(code)).toBe(true);
    }
  });

  it("no repite códigos: el espacio es de 32^8 combinaciones", () => {
    const codes = new Set(Array.from({ length: 5000 }, () => createReservationShortCode()));
    expect(codes.size).toBe(5000);
  });

  it("nunca es una capability: no abre la reserva como el código largo", () => {
    for (let index = 0; index < 200; index += 1) {
      expect(isPrivateReservationCode(createReservationShortCode())).toBe(false);
    }
    expect(isPrivateReservationCode(createReservationCode())).toBe(true);
  });

  it("se busca igual con guiones, espacios o minúsculas, y se muestra en dos bloques", () => {
    expect(formatShortCode("abcd2345")).toBe("ABCD-2345");
    expect(normalizeShortCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizeShortCode(" ABCD 2345 ")).toBe("ABCD2345");
    expect(normalizeShortCode("ABCD2345")).toBe("ABCD2345");
    expect(isShortCode("abcd-2345")).toBe(true);
    expect(isShortCode("ABCD-234")).toBe(false);
    expect(isShortCode("ABCD-234O")).toBe(false);
  });
});
