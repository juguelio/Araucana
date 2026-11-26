/**
 * Nombres cortos de los aeropuertos que aparecen en los vuelos de Chapelco (CPC).
 *
 * El pasajero necesita reconocer de dónde viene su vuelo: "AR1656" solo no le dice nada, y dos
 * vuelos de la misma aerolínea a la misma hora son indistinguibles si no se muestra el origen.
 */

const NOMBRES: Record<string, string> = {
  AEP: "Aeroparque (AEP)",
  EZE: "Ezeiza (EZE)",
  CPC: "Chapelco (CPC)",
  COR: "Córdoba (COR)",
  MDZ: "Mendoza (MDZ)",
  BRC: "Bariloche (BRC)",
  NQN: "Neuquén (NQN)",
  ROS: "Rosario (ROS)",
  SAL: "Salta (SAL)",
  TUC: "Tucumán (TUC)",
  IGR: "Iguazú (IGR)",
  REL: "Trelew (REL)",
  CRD: "Comodoro Rivadavia (CRD)",
  USH: "Ushuaia (USH)",
  // El tablero del aeropuerto publica la ciudad, no el código: se traduce igual para que dos
  // filas del mismo vuelo (una de la API y otra del tablero) se lean igual.
  AEROPARQUE: "Aeroparque (AEP)",
  EZEIZA: "Ezeiza (EZE)",
  CORDOBA: "Córdoba (COR)",
  MENDOZA: "Mendoza (MDZ)",
  BARILOCHE: "Bariloche (BRC)",
  NEUQUEN: "Neuquén (NQN)",
  ROSARIO: "Rosario (ROS)",
  SALTA: "Salta (SAL)",
  TUCUMAN: "Tucumán (TUC)",
  IGUAZU: "Iguazú (IGR)",
  TRELEW: "Trelew (REL)",
  CHAPELCO: "Chapelco (CPC)"
};

/** Normaliza el texto a una clave del mapa: mayúsculas y sin acentos. */
const clave = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

/** Nombre reconocible del aeropuerto; si no lo conocemos devuelve el código tal cual. */
export function aeropuertoLabel(codigo: string | null | undefined): string | null {
  const code = clave(codigo ?? "");
  if (!code || code === "—") return null;
  return NOMBRES[code] ?? (codigo ?? "").trim();
}

/** Las salidas antiguas guardan el destino en origin y algunas conservan CPC como destination. */
export function extremoDelVuelo(vuelo: { direction: string; origin: string; destination?: string | null }): string {
  if (vuelo.direction !== "DEPARTURE") return vuelo.origin;
  const remoto = [vuelo.destination, vuelo.origin].find(lugar =>
    lugar?.trim() && lugar.trim() !== "—" && !/\b(?:CPC|CHAPELCO)\b/i.test(lugar)
  );
  return remoto?.trim() ?? "—";
}

/** La opción de reserva ya trae el aeropuerto del otro extremo en origin. */
export function tramoDeVuelo(vuelo: {
  direction: "ARRIVAL" | "DEPARTURE";
  origin: string | null | undefined;
}): string | null {
  const lugar = aeropuertoLabel(vuelo.origin);
  if (!lugar) return null;
  return vuelo.direction === "ARRIVAL" ? `desde ${lugar}` : `hacia ${lugar}`;
}
