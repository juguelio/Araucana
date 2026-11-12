/**
 * Pronóstico extendido de San Martín de los Andes (issue #73).
 *
 * Misma fuente que el clima actual: Open-Meteo, gratuita y sin API key, siempre desde el
 * servidor y cacheada 30 minutos. Pide 7 días y devuelve sólo lo que la web muestra:
 * fecha, condición, máxima y mínima.
 *
 * Igual que `current.ts`, si el proveedor falla o devuelve algo raro esto devuelve `null`
 * y la home renderiza sin el bloque: el clima no puede tumbar el render.
 */
import { SAN_MARTIN, conditionFromCode, roundTemperature, type WeatherCondition } from "./current";

export const FORECAST_DAYS = 7;

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const REVALIDATE_SECONDS = 1800;
const TIMEOUT_MS = 3500;

export type ForecastDay = {
  /** Fecha local del pronóstico, `YYYY-MM-DD`. */
  date: string;
  condition: WeatherCondition;
  max: number;
  min: number;
};

export type Forecast = {
  location: string;
  days: ForecastDay[];
};

type Payload = {
  daily?: {
    time?: unknown;
    weather_code?: unknown;
    temperature_2m_max?: unknown;
    temperature_2m_min?: unknown;
  };
};

function numbers(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed = value.map((item) => (typeof item === "number" ? item : Number(item)));
  return parsed.every((item) => Number.isFinite(item)) ? parsed : null;
}

function fechas(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed = value.map((item) => String(item));
  return parsed.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item)) ? parsed : null;
}

/**
 * Convierte la respuesta de Open-Meteo en el pronóstico que usa la web.
 * Corta en `days` días y descarta la respuesta si falta alguna de las cuatro series:
 * mostrar días a medias es peor que no mostrar el bloque.
 */
export function parseForecast(payload: unknown, days: number = FORECAST_DAYS): Forecast | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Payload;
  const fechasDia = fechas(data.daily?.time);
  const codigos = numbers(data.daily?.weather_code);
  const maximas = numbers(data.daily?.temperature_2m_max);
  const minimas = numbers(data.daily?.temperature_2m_min);

  if (!fechasDia || !codigos || !maximas || !minimas) return null;
  const cantidad = Math.min(fechasDia.length, codigos.length, maximas.length, minimas.length, Math.max(1, Math.trunc(days)));
  if (cantidad <= 0) return null;

  return {
    location: SAN_MARTIN.label,
    days: Array.from({ length: cantidad }, (_, index) => ({
      date: fechasDia[index],
      condition: conditionFromCode(codigos[index]),
      max: roundTemperature(maximas[index]),
      min: roundTemperature(minimas[index])
    }))
  };
}

export async function getSanMartinForecast(): Promise<Forecast | null> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("latitude", String(SAN_MARTIN.latitude));
  url.searchParams.set("longitude", String(SAN_MARTIN.longitude));
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min");
  url.searchParams.set("timezone", "America/Argentina/Salta");
  url.searchParams.set("forecast_days", String(FORECAST_DAYS));

  try {
    const response = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" }
    });
    if (!response.ok) return null;
    return parseForecast(await response.json());
  } catch {
    return null;
  }
}
