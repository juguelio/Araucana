import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES, isLocale, isPrivatePath, localizePath, splitLocale } from "./config";
import { getDictionary, spanishDictionary } from "./dictionaries";

/** Aplana un objeto en rutas tipo `nav.home` para comparar diccionarios. */
function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

describe("isLocale", () => {
  it("acepta los idiomas declarados y rechaza el resto", () => {
    expect(LOCALES.every(isLocale)).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale("ES")).toBe(false);
  });
});

describe("localizePath", () => {
  it("deja el español sin prefijo", () => {
    expect(localizePath("/", "es")).toBe("/");
    expect(localizePath("/rutas", "es")).toBe("/rutas");
    expect(localizePath("/#servicios", "es")).toBe("/#servicios");
  });

  it("prefija inglés y portugués", () => {
    expect(localizePath("/", "en")).toBe("/en");
    expect(localizePath("/rutas", "en")).toBe("/en/rutas");
    expect(localizePath("/rutas", "pt")).toBe("/pt/rutas");
  });

  it("normaliza rutas sin barra inicial y vacías", () => {
    expect(localizePath("rutas", "en")).toBe("/en/rutas");
    expect(localizePath("", "es")).toBe("/");
    expect(localizePath("", "pt")).toBe("/pt");
  });
});

describe("splitLocale", () => {
  it("separa el prefijo y conserva query", () => {
    expect(splitLocale("/pt/rutas?from=a")).toEqual({ locale: "pt", path: "/rutas?from=a" });
    expect(splitLocale("/en")).toEqual({ locale: "en", path: "/" });
    expect(splitLocale("/en/")).toEqual({ locale: "en", path: "/" });
  });

  it("sin prefijo devuelve español con la ruta intacta", () => {
    expect(splitLocale("/rutas")).toEqual({ locale: "es", path: "/rutas" });
    expect(splitLocale("/")).toEqual({ locale: "es", path: "/" });
  });

  it("no confunde una página con un idioma", () => {
    expect(splitLocale("/esquel")).toEqual({ locale: "es", path: "/esquel" });
  });

  it("es idempotente al ir y volver", () => {
    for (const locale of LOCALES) {
      const path = localizePath("/rutas", locale);
      expect(splitLocale(path)).toEqual({ locale, path: "/rutas" });
    }
  });
});

describe("isPrivatePath", () => {
  it("nunca traduce panel, auth ni API", () => {
    expect(isPrivatePath("/admin/reservas")).toBe(true);
    expect(isPrivatePath("/login")).toBe(true);
    expect(isPrivatePath("/api/v1/airport/address")).toBe(true);
    expect(isPrivatePath("/planilla/abc")).toBe(false);
    expect(isPrivatePath("/rutas")).toBe(false);
  });
});

describe("diccionarios", () => {
  it("inglés y portugués tienen todas las claves del español", () => {
    const base = keys(spanishDictionary).sort();
    expect(keys(getDictionary("en")).sort()).toEqual(base);
    expect(keys(getDictionary("pt")).sort()).toEqual(base);
  });

  it("no dejan textos vacíos", () => {
    for (const locale of LOCALES) {
      const valores = keys(getDictionary(locale)).map((key) => {
        const valor = key.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], getDictionary(locale));
        return typeof valor === "string" ? valor.trim() : "ok";
      });
      expect(valores.every((valor) => valor.length > 0)).toBe(true);
    }
  });

  it("el idioma desconocido cae al español", () => {
    expect(getDictionary(DEFAULT_LOCALE)).toBe(spanishDictionary);
  });
});
