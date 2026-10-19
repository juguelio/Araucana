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
  USH: "Ushuaia (USH)"
};

/** Nombre reconocible del aeropuerto; si no lo conocemos devuelve el código tal cual. */
export function aeropuertoLabel(codigo: string | null | undefined): string | null {
  const code = (codigo ?? "").trim().toUpperCase();
  if (!code || code === "—") return null;
  return NOMBRES[code] ?? code;
}

/**
 * Aeropuerto del otro extremo del vuelo, con la preposición que corresponde.
 *
 * Ojo: `Flight.origin` guarda el aeropuerto del **otro extremo** en las dos direcciones —en una
 * salida desde CPC ahí está el destino—, así que se nombra según el sentido en vez de asumir que
 * siempre es un origen.
 */
export function tramoDeVuelo(vuelo: {
  direction: "ARRIVAL" | "DEPARTURE";
  origin: string | null | undefined;
}): string | null {
  const lugar = aeropuertoLabel(vuelo.origin);
  if (!lugar) return null;
  return vuelo.direction === "ARRIVAL" ? `desde ${lugar}` : `hacia ${lugar}`;
}
