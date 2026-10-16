/**
 * Identidad de la aerolínea para la grilla de vuelos: nombre legible y logo local.
 *
 * Los logos viven en `public/airlines/<IATA>.png` (bajados de la grilla pública de Google
 * Flights, mapeados por código IATA) para que la web no dependa de un tercero en runtime.
 * Si no tenemos el logo de una aerolínea, se muestra el código en un badge: nunca una imagen rota.
 */

export const AIRLINE_NAMES: Record<string, string> = {
  AR: "Aerolíneas Argentinas",
  WJ: "JetSMART",
  JA: "JetSMART",
  LA: "LATAM",
  G3: "GOL",
  AV: "Avianca",
  H2: "Sky",
  CM: "Copa Airlines",
  AA: "American Airlines",
  UA: "United",
  DL: "Delta",
  IB: "Iberia",
  KL: "KLM",
  AF: "Air France",
  BA: "British Airways",
  LH: "Lufthansa"
};

/** Logos que efectivamente tenemos en `public/airlines/`. */
const CON_LOGO = new Set(["AR", "WJ", "JA", "LA", "G3", "AV", "H2", "CM"]);

export function airlineCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return code || null;
}

/** Nombre lindo; si no lo conocemos, devuelve el código tal cual (mejor que inventar). */
export function airlineName(raw: string | null | undefined): string | null {
  const code = airlineCode(raw);
  if (!code) return null;
  return AIRLINE_NAMES[code] ?? code;
}

/** Ruta del logo local, o null si de esa aerolínea no tenemos imagen. */
export function airlineLogo(raw: string | null | undefined): string | null {
  const code = airlineCode(raw);
  if (!code || !CON_LOGO.has(code)) return null;
  return `/airlines/${code}.png`;
}
