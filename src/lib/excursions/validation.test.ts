import { describe, expect, it } from "vitest";
import { excursionLocalDateTime, formatExcursionDate, parseExcursionForm, validateExcursionPhoto } from "./validation";

function form(values: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries({ name: "Lago Lácar", description: "Recorrido con guía", duration: "4 horas", price: "", currency: "ARS", departures: '["2026-12-01T09:30"]', ...values }).forEach(([k, v]) => data.set(k, v));
  return data;
}

describe("excursiones: datos y cronograma", () => {
  it("convierte hora argentina a un instante y conserva el día al editar", () => {
    const data = parseExcursionForm(form());
    expect(data.departures[0].toISOString()).toBe("2026-12-01T12:30:00.000Z");
    expect(excursionLocalDateTime(data.departures[0])).toBe("2026-12-01T09:30");
    expect(formatExcursionDate(new Date("2026-12-02T01:30:00Z"))).toContain("1");
  });
  it("permite borrador sin precio ni fechas, publica sólo con checkbox explícito", () => {
    expect(parseExcursionForm(form({ departures: "[]" }))).toMatchObject({ priceCents: null, isPublished: false, departures: [] });
    expect(parseExcursionForm(form({ isPublished: "on", price: "12500,50" }))).toMatchObject({ isPublished: true, priceCents: 1250050 });
  });
  it.each(["-1", "1.000.000", "1e6", "0", "1.234", "21474836.48"])("rechaza precio inválido %s", (price) => {
    expect(() => parseExcursionForm(form({ price }))).toThrow();
  });
  it.each(["2026-02-30T09:00", "2026-12-01T25:00", "2026-12-01", "garbage"])("rechaza fecha inválida %s", (date) => {
    expect(() => parseExcursionForm(form({ departures: JSON.stringify([date]) }))).toThrow();
  });
  it("rechaza duplicados, exceso de salidas, datos incompletos y JSON roto", () => {
    const invalid: Record<string, string>[] = [{ departures: '["2026-12-01T09:30","2026-12-01T09:30"]' }, { departures: JSON.stringify(Array(101).fill("2026-12-01T09:30")) }, { name: " " }, { description: "" }, { duration: "" }, { currency: "EUR" }, { departures: "{" }];
    for (const values of invalid) {
      expect(() => parseExcursionForm(form(values))).toThrow();
    }
  });
  it("no confunde fechas de fin de mes a medianoche argentina", () => {
    const date = new Date("2027-02-01T03:00:00Z");
    expect(excursionLocalDateTime(date)).toBe("2027-02-01T00:00");
    expect(formatExcursionDate(date)).toContain("feb");
  });
});

describe("excursiones: fotos", () => {
  it("admite imágenes con firma válida, no PDF, SVG ni MIME falso", async () => {
    expect(await validateExcursionPhoto(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "foto.jpg", { type: "image/jpeg" }))).toBeNull();
    for (const file of [new File(["%PDF-"], "doc.pdf", { type: "application/pdf" }), new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }), new File(["not an image"], "fake.png", { type: "image/png" }), new File([], "empty.jpg", { type: "image/jpeg" }), new File([new Uint8Array(3 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" })]) {
      expect(await validateExcursionPhoto(file)).toBeTypeOf("string");
    }
  });
});
