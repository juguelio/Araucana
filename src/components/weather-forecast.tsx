import { getI18n } from "@/i18n/server";
import { LOCALE_TAGS, type Locale } from "@/i18n/config";
import { getSanMartinForecast, type ForecastDay } from "@/lib/weather/forecast";
import { WEATHER_ICON_PATHS } from "@/lib/weather/icons";
import "./weather-forecast.css";

/** Clave `YYYY-MM-DD` de hoy en la zona del hotel, para marcar la primera columna como «Hoy». */
function hoyEnSanMartin() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Salta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

/** «lun», «Mon», «seg» → «Lun», «Mon», «Seg» (sin el punto que agrega es-AR). */
function diaCorto(date: string, locale: Locale) {
  const texto = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(/\.$/, "");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Pronóstico de 7 días en el hero, debajo del botón de reserva (issue #73).
 *
 * Server component: el dato se pide en el servidor y queda cacheado 30 minutos. Si
 * Open-Meteo no responde, no se renderiza nada y el hero queda como estaba.
 */
export async function WeatherForecast() {
  const [forecast, { locale, dict }] = await Promise.all([getSanMartinForecast(), getI18n()]);
  if (!forecast || forecast.days.length < 2) return null;

  const hoy = hoyEnSanMartin();
  const detalle = (dia: ForecastDay) => {
    const condicion = dict.weather.conditions[dia.condition];
    return `${condicion}, ${dict.weather.forecastMax} ${dia.max}°, ${dict.weather.forecastMin} ${dia.min}°`;
  };

  return (
    <div className="hero-forecast" role="group" aria-label={dict.weather.forecastLabel}>
      <p className="hero-forecast-title">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 4v3M7 17v3M3.5 7.5l2 2M14.5 14.5l2 2M4 12h3M17 12h3M6 18a4 4 0 0 1-.6-7.9 5.4 5.4 0 0 1 10.3.9 3.6 3.6 0 0 1 .3 7H6Z" />
        </svg>
        <span>{dict.weather.forecastTitle}</span>
      </p>
      <ol className="hero-forecast-days">
        {forecast.days.map((dia, index) => (
          <li
            className="hero-forecast-day"
            key={dia.date}
            data-hoy={dia.date === hoy || index === 0 ? "true" : undefined}
            title={`${dia.date === hoy ? dict.weather.forecastToday : diaCorto(dia.date, locale)}: ${detalle(dia)}`}
          >
            <span className="hero-forecast-weekday">{dia.date === hoy ? dict.weather.forecastToday : diaCorto(dia.date, locale)}</span>
            <svg className="hero-forecast-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d={WEATHER_ICON_PATHS[dia.condition]} />
            </svg>
            <span className="hero-forecast-temps">
              <b>{dia.max}°</b>
              <span>{dia.min}°</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
