/**
 * Identidad de la aerolínea para la grilla de vuelos: nombre legible y logo local.
 *
 * Los logos viven en `public/airlines/<IATA>.png` (bajados de la grilla pública de Google
 * Flights, mapeados por código IATA) para que la web no dependa de un tercero en runtime.
 * Si no tenemos el logo de una aerolínea, se muestra el código en un badge: nunca una imagen rota.
 * Excepción: el de American Jet lo pasó el cliente (no está en esa grilla porque la aerolínea
 * no figura en AirLabs).
 */

export const AIRLINE_NAMES: Record<string, string> = {
  AR: "Aerolíneas Argentinas",
  // American Jet (ICAO AJB) vuela Neuquén–Chapelco pero **no** está en AirLabs: sus vuelos se
  // cargan a mano desde el horario publicado por el aeropuerto, y la proyección los extiende.
  AJ: "American Jet",
  AJB: "American Jet",
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

/** Logos que efectivamente tenemos en `public/airlines/`. Lo verifica `airlines.test.ts`. */
export const AIRLINE_LOGO_CODES = new Set(["AR", "WJ", "JA", "LA", "G3", "AV", "H2", "CM", "AJ"]);

export function airlineCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return code || null;
}

/** Código con el que se busca el logo: American Jet aparece como `AJ` (IATA) o `AJB` (ICAO). */
function logoCode(code: string): string {
  return code === "AJB" ? "AJ" : code;
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
  if (!code) return null;
  const logo = logoCode(code);
  if (!AIRLINE_LOGO_CODES.has(logo)) return null;
  return `/airlines/${logo}.png`;
}
