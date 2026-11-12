import { jetSmartCanonicalNumber } from "./flights";

/**
 * Unificación de vuelos de JetSMART repetidos (issue #76).
 *
 * Mientras la equivalencia JA/WJ cubría sólo 3182 y 3183, el 3181 y el 3184 quedaron guardados dos
 * veces: JA3184 (tablero) y WJ3184 (API), y las proyecciones de los días siguientes repitieron los
 * dos. Esto decide, para cada vuelo y día, qué fila queda y qué se hace con las otras.
 *
 * Reglas:
 * - Nunca se borra una fila con reservas o combis asignadas. Si hay más de una con reservas, se
 *   dejan todas y se informa: mover reservas de un vuelo a otro lo decide una persona.
 * - Se conserva la fila con reservas o combis; si ninguna tiene, la de la fuente más confiable
 *   (tablero del aeropuerto > API > carga manual > pasajero > proyección) y, a igualdad, la
 *   actualizada más recientemente (el patrón más nuevo).
 * - La fila que queda se guarda con el número JA.
 */
export type FilaDeVuelo = {
  id: string;
  number: string;
  direction: string;
  /** Día local (AAAA-MM-DD) del vuelo. */
  dia: string;
  source: string;
  updatedAt: Date;
  reservas: number;
  combis: number;
};

export type PlanDeUnificacion = {
  /** Filas sin reservas que repiten un vuelo ya cubierto: se borran. */
  borrar: string[];
  /** Filas que quedan pero tienen el número WJ: se pasan a JA. */
  renombrar: Array<{ id: string; number: string }>;
  /** Vuelos que siguen repetidos porque más de una fila tiene reservas o combis. */
  conReservasRepetidas: Array<{ number: string; direction: string; dia: string; ids: string[] }>;
};

const RANGO_FUENTE: Record<string, number> = { FIDS: 0, API: 1, MANUAL: 2, PASAJERO: 3, ESTIMADO: 4 };
const rango = (source: string) => RANGO_FUENTE[source] ?? 5;
const ocupada = (f: FilaDeVuelo) => f.reservas > 0 || f.combis > 0;

export function planificarUnificacionJetSmart(filas: readonly FilaDeVuelo[]): PlanDeUnificacion {
  const plan: PlanDeUnificacion = { borrar: [], renombrar: [], conReservasRepetidas: [] };
  const grupos = new Map<string, FilaDeVuelo[]>();
  for (const fila of filas) {
    const canonico = jetSmartCanonicalNumber(fila.number);
    if (!canonico) continue;
    const clave = `${canonico}|${fila.direction}|${fila.dia}`;
    const grupo = grupos.get(clave);
    if (grupo) grupo.push(fila);
    else grupos.set(clave, [fila]);
  }

  for (const [clave, grupo] of grupos) {
    const [canonico, direction, dia] = clave.split("|");
    const ordenadas = [...grupo].sort(
      (a, b) =>
        Number(ocupada(b)) - Number(ocupada(a)) ||
        rango(a.source) - rango(b.source) ||
        b.updatedAt.getTime() - a.updatedAt.getTime()
    );
    const [queda, ...resto] = ordenadas;

    const otrasOcupadas = resto.filter(ocupada);
    if (otrasOcupadas.length > 0) {
      plan.conReservasRepetidas.push({ number: canonico, direction, dia, ids: [queda, ...otrasOcupadas].map((f) => f.id) });
    }
    for (const fila of resto) {
      if (!ocupada(fila)) plan.borrar.push(fila.id);
    }
    // Sólo se renombra si después de la limpieza no queda otra fila JA ese día (la clave única de
    // la base es número + horario + sentido; con otra JA con reservas, la WJ se deja como está).
    if (queda.number !== canonico && otrasOcupadas.every((f) => f.number !== canonico)) {
      plan.renombrar.push({ id: queda.id, number: canonico });
    }
  }

  return plan;
}
