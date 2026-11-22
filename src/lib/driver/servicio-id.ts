/**
 * Los servicios del día viajan con un id con el área adelante: `salida-<id>`, `vuelo-<id>`,
 * `chapelco-<id>`, `especial-<id>` (los arma `cargarServiciosDelDia`). El prefijo es lo que le dice a
 * «asignar nave» contra qué tabla escribir, así que se parsea en un solo lugar y con test.
 */

export type AreaDeServicioId = "RUTA" | "AEROPUERTO" | "CHAPELCO" | "ESPECIAL";

const AREA_POR_PREFIJO: Record<string, AreaDeServicioId> = {
  salida: "RUTA",
  vuelo: "AEROPUERTO",
  chapelco: "CHAPELCO",
  especial: "ESPECIAL"
};

export function parseServicioId(servicioId: string): { area: AreaDeServicioId; id: string } | null {
  const match = /^(salida|vuelo|chapelco|especial)-(.+)$/.exec(servicioId.trim());
  if (!match) return null;
  const id = match[2].trim();
  if (!id) return null;
  return { area: AREA_POR_PREFIJO[match[1]], id };
}

/**
 * Desde «Naves en vivo» sólo se asigna directo ruta y aeropuerto: comparten la flota de pasajeros y
 * tienen el mismo par nave + chofer. Chapelco (turnos de una semana) y los viajes especiales se
 * asignan en su tablero, donde se define el horario del turno o del viaje.
 */
export function seAsignaDesdeNavesEnVivo(area: AreaDeServicioId) {
  return area === "RUTA" || area === "AEROPUERTO";
}
