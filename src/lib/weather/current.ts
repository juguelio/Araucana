/**
 * Clima actual de San Martín de los Andes.
 *
 * Fuente: Open-Meteo (https://open-meteo.com), gratuita y sin API key. La consulta
 * sale siempre del servidor y se cachea 30 minutos, así que una visita no dispara
 * un request por pasajero y no hay credenciales en el cliente.
 *
 * Si el proveedor no responde o devuelve algo inesperado, `getSanMartinWeather`
 * devuelve `null` y la web simplemente no muestra el bloque: el clima nunca puede
 * tumbar el render de la home.
 */

export const SAN_MARTIN = {
  label: "San Martín de los Andes",
  latitude: -40.1579,
  longitude: -71.3532
} as const;

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const REVALIDATE_SECONDS = 1800;
const TIMEOUT_MS = 3500;

export type WeatherCondition = "despejado" | "parcial" | "nublado" | "lluvia" | "nieve" | "tormenta";

export type Weather = {
  location: string;
  temperature: number;
  feelsLike: number;
  max: number;
  min: number;
  condition: WeatherCondition;
};

export const CONDITION_TEXT: Record<WeatherCondition, string> = {
  despejado: "Despejado",
  parcial: "Parcialmente nublado",
  nublado: "Nublado",
  lluvia: "Lluvia",
  nieve: "Nieve",
  tormenta: "Tormenta"
};

/** Traduce los códigos WMO que devuelve Open-Meteo a las seis condiciones que mostramos. */
export function conditionFromCode(code: number): WeatherCondition {
  if (code === 0 || code === 1) return "despejado";
  if (code === 2) return "parcial";
  if (code === 3 || code === 45 || code === 48) return "nublado";
  if (code >= 95) return "tormenta";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "nieve";
  return "lluvia";
}

export function roundTemperature(value: number): number {
  const redondeado = Math.round(value);
  // Math.round(-0.4) devuelve -0 y en pantalla se vería "-0°": lo normalizamos.
  return Object.is(redondeado, -0) ? 0 : redondeado;
}

type Payload = {
  current?: { temperature_2m?: unknown; apparent_temperature?: unknown; weather_code?: unknown };
  daily?: {
    temperature_2m_max?: unknown;
    temperature_2m_min?: unknown;
    weather_code?: unknown;
  };
};

function numbers(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed = value.map((item) => (typeof item === "number" ? item : Number(item)));
  return parsed.every((item) => Number.isFinite(item)) ? (parsed as number[]) : null;
}

/** Convierte la respuesta cruda de Open-Meteo en el modelo que usa la web. */
export function parseWeather(payload: unknown): Weather | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Payload;
  const temperature = data.current?.temperature_2m;
  const feelsLike = data.current?.apparent_temperature;
  const code = data.current?.weather_code;
  const max = numbers(data.daily?.temperature_2m_max);
  const min = numbers(data.daily?.temperature_2m_min);

  if (typeof temperature !== "number" || !Number.isFinite(temperature)) return null;
  if (typeof code !== "number" || !Number.isFinite(code)) return null;
  if (!max || !min) return null;

  return {
    location: SAN_MARTIN.label,
    temperature: roundTemperature(temperature),
    feelsLike: roundTemperature(typeof feelsLike === "number" && Number.isFinite(feelsLike) ? feelsLike : temperature),
    max: roundTemperature(max[0]),
    min: roundTemperature(min[0]),
    condition: conditionFromCode(code)
  };
}

export async function getSanMartinWeather(): Promise<Weather | null> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("latitude", String(SAN_MARTIN.latitude));
  url.searchParams.set("longitude", String(SAN_MARTIN.longitude));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min");
  url.searchParams.set("timezone", "America/Argentina/Salta");
  url.searchParams.set("forecast_days", "1");

  try {
    const response = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" }
    });
    if (!response.ok) return null;
    return parseWeather(await response.json());
  } catch {
    return null;
  }
}
