import { describe, expect, it } from "vitest";
import { FORECAST_DAYS, parseForecast } from "./forecast";

/** Respuesta recortada de Open-Meteo para San Martín de los Andes (7 días, timezone local). */
const respuestaReal = {
  latitude: -40.10545,
  longitude: -71.34451,
  timezone: "America/Argentina/Salta",
  daily_units: { time: "iso8601", temperature_2m_max: "°C", temperature_2m_min: "°C", weather_code: "wmo code" },
  daily: {
    time: ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"],
    weather_code: [0, 2, 3, 61, 71, 95, 1],
    temperature_2m_max: [25.7, 24.2, 18.4, 12.1, 6.4, 9.9, 21.5],
    temperature_2m_min: [9.7, 8.1, 7.6, 5.2, -0.4, 1.1, 6.3]
  }
};

describe("parseForecast", () => {
  it("arma los siete días con condición, máxima y mínima", () => {
    const pronostico = parseForecast(respuestaReal);
    expect(pronostico).not.toBeNull();
    expect(pronostico!.location).toBe("San Martín de los Andes");
    expect(pronostico!.days).toHaveLength(FORECAST_DAYS);
    expect(pronostico!.days[0]).toEqual({ date: "2026-11-12", condition: "despejado", max: 26, min: 10 });
    expect(pronostico!.days[3]).toEqual({ date: "2026-11-15", condition: "lluvia", max: 12, min: 5 });
    expect(pronostico!.days[4].condition).toBe("nieve");
    expect(pronostico!.days[5].condition).toBe("tormenta");
  });

  it("no muestra -0° cuando la mínima redondea para arriba de cero", () => {
    const pronostico = parseForecast(respuestaReal);
    // -0.4 °C redondea a 0 y Math.round devuelve -0: en pantalla se vería "-0°".
    expect(Object.is(pronostico!.days[4].min, -0)).toBe(false);
    expect(pronostico!.days[4].min).toBe(0);
  });

  it("corta los días que sobran si el proveedor devuelve más de una semana", () => {
    const diezDias = {
      daily: {
        time: Array.from({ length: 10 }, (_, i) => `2026-11-${String(12 + i).padStart(2, "0")}`),
        weather_code: Array.from({ length: 10 }, () => 0),
        temperature_2m_max: Array.from({ length: 10 }, (_, i) => 20 + i),
        temperature_2m_min: Array.from({ length: 10 }, (_, i) => 5 + i)
      }
    };
    expect(parseForecast(diezDias)!.days).toHaveLength(FORECAST_DAYS);
    expect(parseForecast(diezDias, 3)!.days.map((dia) => dia.date)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
  });

  it("se queda con lo que hay si el proveedor devuelve menos días", () => {
    const tresDias = {
      daily: {
        time: ["2026-11-12", "2026-11-13", "2026-11-14"],
        weather_code: [0, 2, 3],
        temperature_2m_max: [20, 21, 22],
        temperature_2m_min: [5, 6, 7]
      }
    };
    expect(parseForecast(tresDias)!.days).toHaveLength(3);
  });

  it("acepta números como texto (Open-Meteo a veces los manda así)", () => {
    const conTexto = {
      daily: {
        time: ["2026-11-12", "2026-11-13"],
        weather_code: ["0", "61"],
        temperature_2m_max: ["20.4", "15"],
        temperature_2m_min: ["5.6", "3"]
      }
    };
    expect(parseForecast(conTexto)!.days).toEqual([
      { date: "2026-11-12", condition: "despejado", max: 20, min: 6 },
      { date: "2026-11-13", condition: "lluvia", max: 15, min: 3 }
    ]);
  });

  it("devuelve null en vez de mostrar días a medias", () => {
    expect(parseForecast(null)).toBeNull();
    expect(parseForecast({})).toBeNull();
    expect(parseForecast({ daily: {} })).toBeNull();
    // Falta la serie de mínimas.
    expect(parseForecast({ daily: { time: ["2026-11-12"], weather_code: [0], temperature_2m_max: [20] } })).toBeNull();
    // Una temperatura no numérica arrastra toda la respuesta.
    expect(
      parseForecast({ daily: { time: ["2026-11-12"], weather_code: [0], temperature_2m_max: ["n/d"], temperature_2m_min: [5] } })
    ).toBeNull();
    // Fecha que no es YYYY-MM-DD.
    expect(
      parseForecast({ daily: { time: ["12/11/2026"], weather_code: [0], temperature_2m_max: [20], temperature_2m_min: [5] } })
    ).toBeNull();
    // Series vacías.
    expect(parseForecast({ daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] } })).toBeNull();
  });

  it("recorta a la serie más corta si vienen desparejas", () => {
    const desparejo = {
      daily: {
        time: ["2026-11-12", "2026-11-13", "2026-11-14"],
        weather_code: [0, 2],
        temperature_2m_max: [20, 21, 22],
        temperature_2m_min: [5, 6, 7]
      }
    };
    expect(parseForecast(desparejo)!.days).toHaveLength(2);
  });
});
