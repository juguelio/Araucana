/**
 * La jornada de los choferes (tablero de Choferes, 24-nov): qué servicio maneja cada uno un día,
 * con qué nave, y qué servicios de una nave hay ese día para asignarlos a un chofer de una vez.
 *
 * Es lógica pura sobre una lista de servicios del día (`cargarServiciosDelDia`); la página y la acción
 * de asignar la usan igual.
 */

export type AreaDeServicio = "SERVICIO_PUBLICO" | "AEROPUERTO" | "VIAJE_ESPECIAL" | "CHAPELCO" | "CONCESION";

export type ServicioDelDia = {
  /** `salida:<scheduleId>`, `unidad:<scheduleUnitId>`, `vuelo:<assignmentId>`, `viaje:<assignmentId>`, `chapelco:<dutyId>`. */
  clave: string;
  area: AreaDeServicio;
  vehicleId: string;
  driverId: string | null;
  desde: Date;
  hasta: Date;
  /** «San Martín → Villa Traful» · «Partida AR1659» · cliente del viaje · «Chapelco». */
  titulo: string;
  href: string;
  turno?: string;
  /** Chapelco tiene su propio tablero (paradas por chofer): desde Choferes sólo se ve. */
  asignableDesdeChoferes: boolean;
};

export const ETIQUETA_AREA: Record<AreaDeServicio, string> = {
  SERVICIO_PUBLICO: "Servicio público",
  AEROPUERTO: "Aeropuerto",
  VIAJE_ESPECIAL: "Viaje especial",
  CONCESION: "Concesiones",
  CHAPELCO: "Chapelco"
};

const porHora = (a: ServicioDelDia, b: ServicioDelDia) => a.desde.getTime() - b.desde.getTime() || a.clave.localeCompare(b.clave);

/** Los servicios que maneja un chofer ese día, por hora. */
export function jornadaDe(driverId: string, servicios: readonly ServicioDelDia[]): ServicioDelDia[] {
  return servicios.filter((servicio) => servicio.driverId === driverId).sort(porHora);
}

/** Las naves que maneja ese día, en el orden en que las usa (sin repetir). */
export function navesDeLaJornada(jornada: readonly ServicioDelDia[]): string[] {
  return [...new Set(jornada.map((servicio) => servicio.vehicleId))];
}

/** Los servicios de una nave ese día, por hora: lo que se asigna junto al elegir «chofer → nave». */
export function serviciosDeLaNave(vehicleId: string, servicios: readonly ServicioDelDia[]): ServicioDelDia[] {
  return servicios.filter((servicio) => servicio.vehicleId === vehicleId).sort(porHora);
}

/**
 * Qué viene tildado al asignar la nave a un chofer: lo que no tiene chofer o ya es suyo. Lo que maneja
 * otro chofer queda sin tildar (sacárselo es una decisión, no un efecto colateral), y Chapelco no se
 * asigna desde acá.
 */
export function preseleccion(servicio: ServicioDelDia, driverId: string): boolean {
  if (!servicio.asignableDesdeChoferes) return false;
  return !servicio.driverId || servicio.driverId === driverId;
}

/** Lo que está pasando a esta hora: el servicio en curso de la jornada, si hay. */
export function enCurso(jornada: readonly ServicioDelDia[], ahora: Date): ServicioDelDia | null {
  return jornada.find((servicio) => servicio.desde <= ahora && ahora < servicio.hasta) ?? null;
}

/** El próximo que todavía no empezó. */
export function proximo(jornada: readonly ServicioDelDia[], ahora: Date): ServicioDelDia | null {
  return jornada.find((servicio) => servicio.desde > ahora) ?? null;
}

/** Horas manejando ese día (la suma de los tramos, sin contar dos veces lo superpuesto). */
export function horasDeLaJornada(jornada: readonly ServicioDelDia[]): number {
  const tramos = [...jornada].sort(porHora).map((servicio) => [servicio.desde.getTime(), servicio.hasta.getTime()] as const);
  let total = 0;
  let finAnterior = -Infinity;
  for (const [desde, hasta] of tramos) {
    const inicio = Math.max(desde, finAnterior);
    if (hasta > inicio) total += hasta - inicio;
    finAnterior = Math.max(finAnterior, hasta);
  }
  return total / 3_600_000;
}

/**
 * La línea del día (05:00 a 24:00 de Argentina) y dónde cae cada servicio, en porcentaje. Lo que
 * empezó el día anterior o termina después de medianoche se corta en el borde.
 */
export const LINEA_DESDE_HORA = 5;
export const LINEA_HASTA_HORA = 24;

/** Dónde empieza y termina la línea de ese día, en milisegundos (05:00 y 24:00 de Argentina). */
export function limitesDeLinea(dia: string): { inicio: number; fin: number } {
  return {
    inicio: new Date(`${dia}T${String(LINEA_DESDE_HORA).padStart(2, "0")}:00:00-03:00`).getTime(),
    fin: new Date(`${dia}T00:00:00-03:00`).getTime() + LINEA_HASTA_HORA * 3_600_000
  };
}

/**
 * Dónde cae «ahora» en la línea, en porcentaje con un decimal; null antes de las 05 o después de
 * las 24 (no hay dónde marcarlo). Lo usan la pastilla de la regla y la sombra de lo que ya pasó.
 */
export function posicionDeAhora(ahora: number, limites: { inicio: number; fin: number }): number | null {
  if (ahora < limites.inicio || ahora > limites.fin) return null;
  return Math.round(((ahora - limites.inicio) / (limites.fin - limites.inicio)) * 1000) / 10;
}

export function bloqueEnLinea(servicio: Pick<ServicioDelDia, "desde" | "hasta">, dia: string): { izquierda: number; ancho: number } | null {
  const { inicio, fin } = limitesDeLinea(dia);
  const desde = Math.max(servicio.desde.getTime(), inicio);
  const hasta = Math.min(servicio.hasta.getTime(), fin);
  if (hasta <= desde) return null;
  const total = fin - inicio;
  return { izquierda: ((desde - inicio) / total) * 100, ancho: Math.max(((hasta - desde) / total) * 100, 1.2) };
}

/** Pestañas del tablero de choferes. */
export const PESTANAS_CHOFERES = ["trabajan", "libres", "documentacion", "todos", "inactivos"] as const;
export type PestanaChoferes = (typeof PESTANAS_CHOFERES)[number];

export function leerPestanaChoferes(valor: string | undefined): PestanaChoferes {
  return (PESTANAS_CHOFERES as readonly string[]).includes(valor ?? "") ? (valor as PestanaChoferes) : "trabajan";
}

export function entraEnPestanaChoferes(
  pestana: PestanaChoferes,
  chofer: { isActive: boolean; servicios: number; documentacionEnOrden: boolean }
): boolean {
  switch (pestana) {
    case "trabajan":
      return chofer.isActive && chofer.servicios > 0;
    case "libres":
      return chofer.isActive && chofer.servicios === 0;
    case "documentacion":
      return chofer.isActive && !chofer.documentacionEnOrden;
    case "todos":
      return chofer.isActive;
    case "inactivos":
      return !chofer.isActive;
  }
}

/** Iniciales para el avatar: «Ramón Paz» → «RP»; sin nombre, la primera letra del email. */
export function iniciales(nombre: string | null, email: string): string {
  const partes = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return email.slice(0, 1).toUpperCase();
}

/**
 * Carriles de la línea: dos servicios que se pisan (un cruce aceptado, o el chofer en dos naves a la
 * vez) van uno arriba del otro en vez de taparse. Devuelve el carril de cada servicio y cuántos hay.
 */
export function carriles(jornada: readonly Pick<ServicioDelDia, "clave" | "desde" | "hasta">[]): { carril: Map<string, number>; total: number } {
  const finDeCarril: number[] = [];
  const carril = new Map<string, number>();
  for (const servicio of [...jornada].sort((a, b) => a.desde.getTime() - b.desde.getTime())) {
    let libre = finDeCarril.findIndex((fin) => fin <= servicio.desde.getTime());
    if (libre === -1) libre = finDeCarril.length;
    finDeCarril[libre] = servicio.hasta.getTime();
    carril.set(servicio.clave, libre);
  }
  return { carril, total: Math.max(1, finDeCarril.length) };
}
