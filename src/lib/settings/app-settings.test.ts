import { describe, expect, it } from "vitest";
import { maskSecret, resolveSecret, secretSource } from "./app-settings";

describe("clave de AirLabs configurable", () => {
  it("la variable de entorno gana sobre lo cargado en el panel", () => {
    expect(resolveSecret("env-key", "panel-key")).toBe("env-key");
    expect(secretSource("env-key", "panel-key")).toBe("env");
  });

  it("sin variable de entorno usa la del panel", () => {
    expect(resolveSecret(undefined, "panel-key")).toBe("panel-key");
    expect(resolveSecret("  ", "panel-key")).toBe("panel-key");
    expect(secretSource("", "panel-key")).toBe("panel");
  });

  it("sin ninguna de las dos no hay clave (y se dice)", () => {
    expect(resolveSecret(null, null)).toBeNull();
    expect(resolveSecret("   ", "")).toBeNull();
    expect(secretSource(undefined, undefined)).toBe("none");
  });

  it("nunca expone la clave entera al navegador", () => {
    const key = "f7afa865-f8ad-4c9c-81c9-ec79aa0c3008";
    const masked = maskSecret(key)!;
    expect(masked).toBe("f7af…3008");
    expect(masked).not.toContain("f8ad");
    expect(masked.length).toBeLessThan(key.length);
  });

  it("una clave corta se muestra entera como puntos", () => {
    expect(maskSecret("corta")).toBe("••••");
    expect(maskSecret("")).toBeNull();
    expect(maskSecret(null)).toBeNull();
  });
});
