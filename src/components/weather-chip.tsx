import { getSanMartinWeather } from "@/lib/weather/current";
import { WEATHER_ICON_PATHS } from "@/lib/weather/icons";
import { getI18n } from "@/i18n/server";
import "./weather-chip.css";

/**
 * Clima en la barra del sitio, al lado del logo. Server component: el dato se pide
 * en el servidor y queda cacheado, así que el visitante no pega contra la API.
 * Si el proveedor falla, no se renderiza nada y el header queda igual.
 */
export async function WeatherChip() {
  const [weather, { dict }] = await Promise.all([getSanMartinWeather(), getI18n()]);
  if (!weather) return null;

  const condicion = dict.weather.conditions[weather.condition];
  const detalle = `${weather.location}: ${condicion}, ${weather.temperature}° (máx ${weather.max}° / mín ${weather.min}°)`;

  return (
    <span className="weather-chip" title={detalle} aria-label={detalle}>
      <svg className="weather-chip-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d={WEATHER_ICON_PATHS[weather.condition]} />
      </svg>
      <span className="weather-chip-temp">{weather.temperature}°</span>
      <span className="weather-chip-text">{condicion}</span>
    </span>
  );
}
