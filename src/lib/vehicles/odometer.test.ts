import { describe, expect, it } from "vitest";
import { estadoKilometraje, textoKilometraje, UMBRAL_PROXIMO_KM } from "./odometer";

describe("kilometraje entre services (#369)", () => {
  const base = { intervalo: 10_000, ultimoServiceKm: 100_000 };

  it("sin intervalo no inventa alerta", () => {
    expect(estadoKilometraje({ intervalo: null, ultimoServiceKm: 100_000, ultimaLecturaKm: 120_000 }).estado).toBe("sin-dato");
    expect(estadoKilometraje({ intervalo: 0, ultimoServiceKm: 100_000, ultimaLecturaKm: 120_000 }).estado).toBe("sin-dato");
  });

  it("sin lectura o sin km de service queda sin dato", () => {
    expect(estadoKilometraje({ intervalo: 10_000, ultimoServiceKm: null, ultimaLecturaKm: 120_000 }).estado).toBe("sin-dato");
    expect(estadoKilometraje({ intervalo: 10_000, ultimoServiceKm: 100_000, ultimaLecturaKm: null }).estado).toBe("sin-dato");
  });

  it("una lectura menor al km del service no genera aviso", () => {
    expect(estadoKilometraje({ ...base, ultimaLecturaKm: 99_000 })).toEqual({ estado: "sin-dato", recorridos: null, faltan: null });
  });

  it("lejos del intervalo queda ok", () => {
    const estado = estadoKilometraje({ ...base, ultimaLecturaKm: 105_000 });
    expect(estado).toEqual({ estado: "ok", recorridos: 5_000, faltan: 5_000 });
  });

  it("a menos del umbral avisa que está próximo", () => {
    const estado = estadoKilometraje({ ...base, ultimaLecturaKm: 100_000 + 10_000 - UMBRAL_PROXIMO_KM + 1 });
    expect(estado.estado).toBe("proximo");
    expect(estado.faltan).toBe(UMBRAL_PROXIMO_KM - 1);
  });

  it("pasado el intervalo queda vencido con los km de más", () => {
    const estado = estadoKilometraje({ ...base, ultimaLecturaKm: 111_500 });
    expect(estado).toEqual({ estado: "vencido", recorridos: 11_500, faltan: -1_500 });
    expect(textoKilometraje(estado)).toBe("Pasado por 1.500 km: corresponde el service.");
  });

  it("el texto dice cuánto falta", () => {
    expect(textoKilometraje(estadoKilometraje({ ...base, ultimaLecturaKm: 107_700 }))).toBe("Faltan 2.300 km para el service.");
    expect(textoKilometraje({ estado: "sin-dato", recorridos: null, faltan: null })).toBe("Sin datos para calcular el próximo service.");
  });
});
