import type { WeatherCondition } from "./current";

/**
 * Trazos de los íconos del clima en un `viewBox` de 24×24.
 * Los comparten el chip del header y el pronóstico del hero, para que una condición
 * se dibuje igual en los dos lados.
 */
export const WEATHER_ICON_PATHS: Record<WeatherCondition, string> = {
  despejado:
    "M12 4.5v2.2M12 17.3v2.2M4.5 12h2.2M17.3 12h2.2M6.7 6.7l1.6 1.6M15.7 15.7l1.6 1.6M17.3 6.7l-1.6 1.6M8.3 15.7l-1.6 1.6M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z",
  parcial: "M8 9.5a3.4 3.4 0 1 1 5.2-2.8M6.2 17.5h11.3a3.2 3.2 0 0 0 .3-6.4 4.6 4.6 0 0 0-8.9-1 3.4 3.4 0 0 0-2.7 7.4Z",
  nublado: "M6.4 18h11.1a3.4 3.4 0 0 0 .3-6.8 5 5 0 0 0-9.5-1.1 3.6 3.6 0 0 0-1.9 7.9Z",
  lluvia:
    "M6.6 14.4h10.8a3.2 3.2 0 0 0 .2-6.4 4.8 4.8 0 0 0-9.2-1 3.4 3.4 0 0 0-1.8 7.4ZM8.4 17.4l-.9 2.4M12 17.4l-.9 2.4M15.6 17.4l-.9 2.4",
  nieve:
    "M6.6 14.4h10.8a3.2 3.2 0 0 0 .2-6.4 4.8 4.8 0 0 0-9.2-1 3.4 3.4 0 0 0-1.8 7.4ZM9 19h.01M12 18.2h.01M15 19h.01",
  tormenta: "M6.6 14h10.8a3.2 3.2 0 0 0 .2-6.4 4.8 4.8 0 0 0-9.2-1A3.4 3.4 0 0 0 6.6 14ZM12.6 16.6 10.4 20h2.4l-1.1 2.2"
};
