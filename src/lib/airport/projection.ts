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
/**
 * Fuentes que sirven de patrón para proyectar. Incluye MANUAL a propósito: hay aerolíneas que
 * operan en CPC y no están en AirLabs (American Jet), así que su horario se carga a mano una vez
 * y la proyección lo repite igual que el de las que sí trae la API.
 */
const FUENTES_DEL_PATRON = new Set(["API", "MANUAL"]);

/**
 * Proyección **por vuelo**, no por día: cada servicio se repite según su propia frecuencia.
 *
 * Importa porque no todas las aerolíneas vuelan todos los días: American Jet hace Neuquén–Chapelco
 * martes, jueves y sábados. Si proyectáramos "el día completo", esos vuelos aparecerían un lunes.
 *
 * Regla: si conocemos ese mismo día de la semana para ese vuelo, se proyecta; si no lo conocemos y
 * sólo tenemos una muestra (un día distinto), se asume que el servicio es diario; si ya lo vimos en
 * **varios** días distintos y el objetivo no es uno de ellos, no se proyecta.
 */
export function proyectarVuelos(fecha: string, observados: ObservableFlight[]): ProjectedFlight[] {
  const base = observados.filter((o) => FUENTES_DEL_PATRON.has(o.source));
  if (base.length === 0) return [];

  const objetivo = diaDeLaSemana(fecha);
  const porVuelo = new Map<string, ObservableFlight[]>();
  for (const o of base) {
    const direction: FlightDirection = o.direction === "DEPARTURE" ? "DEPARTURE" : "ARRIVAL";
    const clave = `${direction}|${o.number.trim().toUpperCase()}`;
    const actuales = porVuelo.get(clave);
    if (actuales) actuales.push(o);
    else porVuelo.set(clave, [o]);
  }

  const salida = new Map<string, ProjectedFlight>();
  for (const [clave, ocurrencias] of porVuelo) {
    const diasConocidos = new Set(ocurrencias.map((o) => diaDeLaSemana(fechaLocal(o.scheduledAt))));
    const conoceElDia = diasConocidos.has(objetivo);
    if (!conoceElDia && diasConocidos.size > 1) continue;

    // La referencia es la ocurrencia más reciente de ese vuelo (o la del mismo día de la semana).
    const candidatas = conoceElDia
      ? ocurrencias.filter((o) => diaDeLaSemana(fechaLocal(o.scheduledAt)) === objetivo)
      : ocurrencias;
    const referencia = candidatas.reduce((a, b) => (a.scheduledAt > b.scheduledAt ? a : b));

    const direction: FlightDirection = referencia.direction === "DEPARTURE" ? "DEPARTURE" : "ARRIVAL";
    const hora = horaLocal(referencia.scheduledAt);
    const vuelo: ProjectedFlight = {
      number: referencia.number,
      airline: referencia.airline,
      origin: referencia.origin,
      destination: referencia.destination,
      direction,
      scheduledAt: conFechaYHora(fecha, hora),
      estimatedAt: null,
      status: "SCHEDULED",
      externalId: `EST@${fecha}@${referencia.number}@${direction}`,
      source: "ESTIMADO"
    };
    salida.set(`${clave}|${hora}`, vuelo);
  }

  return [...salida.values()].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

/** Días siguientes a proyectar (además de hoy, que se sincroniza con datos reales). */
export const DIAS_PROYECTADOS = 30;
