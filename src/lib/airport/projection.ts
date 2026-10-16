import type { FlightDirection } from "./provider";

/**
 * Proyección del horario de vuelos a los días siguientes.
 *
 * Por qué existe: el plan de AirLabs no publica horarios futuros (sólo el día en curso). El
 * pasajero, igual, necesita ver la grilla de los próximos días para reservar. Lo que hace esto
 * es repetir el patrón **ya observado** de la aerolínea, marcado como ESTIMADO: el día que llega,
 * el dato real de la API reemplaza al estimado. Nunca inventa un vuelo que no se haya visto.
 *
 * Todo acá es puro: no toca red ni base, así se testea.
 */

export type ObservableFlight = {
  number: string;
  airline: string | null;
  origin: string;
  destination: string;
  direction: string;
  scheduledAt: Date;
  source: string;
};

export type ProjectedFlight = {
  number: string;
  airline: string | null;
  origin: string;
  destination: string;
  direction: FlightDirection;
  scheduledAt: Date;
  estimatedAt: null;
  status: "SCHEDULED";
  externalId: string;
  source: "ESTIMADO";
};

const TZ_OFFSET_MIN = -180;

/** Fecha y hora locales del aeropuerto (UTC-3), que es como el pasajero lee la grilla. */
export function fechaLocal(d: Date): string {
  return new Date(d.getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}
export function horaLocal(d: Date): string {
  return new Date(d.getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(11, 16);
}

function diaDeLaSemana(fecha: string): number {
  return new Date(`${fecha}T12:00:00-03:00`).getUTCDay();
}

function conFechaYHora(fecha: string, hora: string): Date {
  return new Date(`${fecha}T${hora}:00-03:00`);
}

/**
 * Proyecta los vuelos observados a `fecha`. Si conocemos el mismo día de la semana, usa ese
 * patrón (los sábados pueden ser distintos a los miércoles); si no, usa el día real más reciente.
 */
export function proyectarVuelos(fecha: string, observados: ObservableFlight[]): ProjectedFlight[] {
  const reales = observados.filter((o) => o.source === "API");
  if (reales.length === 0) return [];

  const objetivo = diaDeLaSemana(fecha);
  const mismos = reales.filter((o) => diaDeLaSemana(fechaLocal(o.scheduledAt)) === objetivo);
  const base = mismos.length > 0 ? mismos : reales;

  // Nos quedamos con el día más reciente del conjunto: es el patrón más nuevo que conocimos.
  const referencia = base.map((o) => fechaLocal(o.scheduledAt)).sort().at(-1)!;
  const delDia = base.filter((o) => fechaLocal(o.scheduledAt) === referencia);

  const salida = new Map<string, ProjectedFlight>();
  for (const o of delDia) {
    const hora = horaLocal(o.scheduledAt);
    const direction: FlightDirection = o.direction === "DEPARTURE" ? "DEPARTURE" : "ARRIVAL";
    const vuelo: ProjectedFlight = {
      number: o.number,
      airline: o.airline,
      origin: o.origin,
      destination: o.destination,
      direction,
      scheduledAt: conFechaYHora(fecha, hora),
      estimatedAt: null,
      status: "SCHEDULED",
      externalId: `EST@${fecha}@${o.number}@${direction}`,
      source: "ESTIMADO"
    };
    salida.set(`${direction}|${o.number}|${hora}`, vuelo);
  }

  return [...salida.values()].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

/** Días siguientes a proyectar (además de hoy, que se sincroniza con datos reales). */
export const DIAS_PROYECTADOS = 30;
