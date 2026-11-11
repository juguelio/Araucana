/**
 * Agrupación de salidas por día en hora de Salta.
 *
 * La operación real tiene cientos de salidas futuras (la ruta de Villa Traful, 258) repartidas en
 * meses: ninguna pantalla puede listarlas todas. La comparten el alta manual del panel y la página
 * pública de reserva, para que las dos muestren el mismo universo de días: sólo los que tienen
 * lugares libres.
 */

export const ZONA_OPERATIVA = "America/Argentina/Salta";

/** Cuántos días caben en la tira corta del panel; el resto se elige con el calendario. */
export const DIAS_EN_TIRA = 7;

const claveFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_OPERATIVA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const diaFormatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_OPERATIVA,
  weekday: "short",
  day: "2-digit",
  month: "short"
});

const horaFormatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_OPERATIVA,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

/** Clave ordenable del día (`2026-11-14`), en hora argentina y no en UTC. */
export function diaKey(value: Date | string) {
  return claveFormatter.format(new Date(value));
}

export function etiquetasDeSalida(value: Date | string) {
  const fecha = new Date(value);

  return {
    dayKey: claveFormatter.format(fecha),
    dayLabel: diaFormatter.format(fecha).replace(/\.$/, "").replace(/\u00a0/g, " "),
    timeLabel: horaFormatter.format(fecha)
  };
}

export type DiaConSalidas = { key: string; label: string; count: number };

/** Días con salidas, en orden y con el conteo que se muestra en cada botón. */
export function diasConSalidas<T extends { dayKey: string; dayLabel: string }>(salidas: T[]): DiaConSalidas[] {
  const mapa = new Map<string, DiaConSalidas>();

  for (const salida of salidas) {
    const actual = mapa.get(salida.dayKey);
    if (actual) actual.count += 1;
    else mapa.set(salida.dayKey, { key: salida.dayKey, label: salida.dayLabel, count: 1 });
  }

  return [...mapa.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** El día elegido si todavía tiene salidas; si no, el primero disponible. */
export function diaEfectivo(dias: DiaConSalidas[], elegido: string) {
  if (elegido && dias.some((dia) => dia.key === elegido)) return elegido;
  return dias[0]?.key ?? "";
}

/**
 * Los próximos días con salidas. Si se eligió una fecha lejana (calendario o link con `scheduleId`),
 * ese día se agrega primero: lo seleccionado no puede quedar fuera de la tira.
 */
export function tiraDeDias(dias: DiaConSalidas[], efectivo: string, limite = DIAS_EN_TIRA): DiaConSalidas[] {
  const primeros = dias.slice(0, limite);
  if (!efectivo || primeros.some((dia) => dia.key === efectivo)) return primeros;

  const elegido = dias.find((dia) => dia.key === efectivo);
  return elegido ? [elegido, ...primeros] : primeros;
}
