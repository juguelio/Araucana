import { describe, expect, it } from "vitest";

import { formatTicketNumber, parseTicketNumber, requiereBoletoNumerado, SERIE_WEB } from "./numbering";

describe("numeración de boletos", () => {
  it("arma el número con tres dígitos para la serie web", () => {
    expect(formatTicketNumber(SERIE_WEB, 1)).toBe("W001");
    expect(formatTicketNumber(SERIE_WEB, 42)).toBe("W042");
    expect(formatTicketNumber(SERIE_WEB, 999)).toBe("W999");
  });

  it("no recorta el número cuando pasa de mil", () => {
    expect(formatTicketNumber(SERIE_WEB, 1000)).toBe("W1000");
    expect(formatTicketNumber(SERIE_WEB, 123456)).toBe("W123456");
  });

  it("rechaza correlativos que no existen", () => {
    expect(() => formatTicketNumber(SERIE_WEB, 0)).toThrow();
    expect(() => formatTicketNumber(SERIE_WEB, -3)).toThrow();
    expect(() => formatTicketNumber(SERIE_WEB, 1.5)).toThrow();
  });

  it("vuelve del número mostrado al correlativo", () => {
    expect(parseTicketNumber("W001")).toEqual({ series: "W", numero: 1 });
    expect(parseTicketNumber(" w42 ")).toEqual({ series: "W", numero: 42 });
    expect(parseTicketNumber("W1000")).toEqual({ series: "W", numero: 1000 });
  });

  it("no inventa un boleto con texto que no es un número", () => {
    expect(parseTicketNumber("")).toBeNull();
    expect(parseTicketNumber("W")).toBeNull();
    expect(parseTicketNumber("001")).toBeNull();
    expect(parseTicketNumber("W00A")).toBeNull();
    expect(parseTicketNumber("W000")).toBeNull();
  });

  it("sólo el servicio público lleva boleto numerado", () => {
    expect(requiereBoletoNumerado("SEATED")).toBe(true);
    expect(requiereBoletoNumerado("AIRPORT")).toBe(false);
    expect(requiereBoletoNumerado("CHAPELCO")).toBe(false);
    expect(requiereBoletoNumerado(null)).toBe(false);
    expect(requiereBoletoNumerado(undefined)).toBe(false);
  });
});
