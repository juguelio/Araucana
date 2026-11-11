import { describe, expect, it } from "vitest";
import { CONDITION_TEXT, conditionFromCode, parseWeather, roundTemperature } from "./current";

const respuestaReal = {
  latitude: -40.10545,
  longitude: -71.34451,
  timezone: "America/Argentina/Salta",
  current: {
    time: "2026-11-11T14:30",
    interval: 900,
    temperature_2m: 25.4,
    apparent_temperature: 24.9,
    weather_code: 3
  },
  daily: {
    time: ["2026-11-11"],
    weather_code: [45],
    temperature_2m_max: [25.7],
    temperature_2m_min: [9.7]
  }
};

describe("conditionFromCode", () => {
  it("mapea despejado y mayormente despejado", () => {
    expect(conditionFromCode(0)).toBe("despejado");
    expect(conditionFromCode(1)).toBe("despejado");
  });

  it("mapea parcialmente nublado y cubierto/niebla", () => {
    expect(conditionFromCode(2)).toBe("parcial");
    expect(conditionFromCode(3)).toBe("nublado");
    expect(conditionFromCode(45)).toBe("nublado");
    expect(conditionFromCode(48)).toBe("nublado");
  });

  it("distingue lluvia, nieve y tormenta", () => {
    expect(conditionFromCode(61)).toBe("lluvia");
    expect(conditionFromCode(82)).toBe("lluvia");
    expect(conditionFromCode(71)).toBe("nieve");
    expect(conditionFromCode(86)).toBe("nieve");
    expect(conditionFromCode(95)).toBe("tormenta");
    expect(conditionFromCode(99)).toBe("tormenta");
  });

  it("trata cualquier código raro como lluvia en vez de romper", () => {
    expect(conditionFromCode(7)).toBe("lluvia");
  });
});

describe("roundTemperature", () => {
  it("redondea al entero más cercano", () => {
    expect(roundTemperature(25.4)).toBe(25);
    expect(roundTemperature(25.7)).toBe(26);
    expect(roundTemperature(-0.4)).toBe(0);
  });
});

describe("parseWeather", () => {
  it("extrae temperatura, sensación, extremos y condición", () => {
    expect(parseWeather(respuestaReal)).toEqual({
      location: "San Martín de los Andes",
      temperature: 25,
      feelsLike: 25,
      max: 26,
      min: 10,
      condition: "nublado"
    });
  });

  it("usa la temperatura como sensación cuando el proveedor no la manda", () => {
    const sinSensacion = { ...respuestaReal, current: { temperature_2m: 12.2, weather_code: 0 } };
    expect(parseWeather(sinSensacion)?.feelsLike).toBe(12);
  });

  it("devuelve null si falta la temperatura actual", () => {
    expect(parseWeather({ ...respuestaReal, current: { weather_code: 0 } })).toBeNull();
  });

  it("devuelve null si no hay máximas ni mínimas del día", () => {
    expect(parseWeather({ ...respuestaReal, daily: undefined })).toBeNull();
  });

  it("devuelve null con basura en vez de tirar una excepción", () => {
    expect(parseWeather(null)).toBeNull();
    expect(parseWeather("{}")).toBeNull();
    expect(parseWeather({ current: { temperature_2m: "calor" } })).toBeNull();
  });
});

describe("CONDITION_TEXT", () => {
  it("tiene texto para todas las condiciones del icono", () => {
    expect(Object.keys(CONDITION_TEXT).sort()).toEqual(["despejado", "lluvia", "nieve", "nublado", "parcial", "tormenta"]);
  });
});
