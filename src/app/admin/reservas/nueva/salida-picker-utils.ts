/**
 * Lógica del selector de salida del alta manual (sin React, para poder testearla).
 *
 * La operación real tiene cientos de salidas futuras repartidas en meses: la pantalla no puede
 * listar todas, tiene que abrir en el próximo día con salidas y ofrecer una tira corta de días.
 */

export type SalidaOption = {
  id: string;
  from: string;
  to: string;
  dayKey: string;
  dayLabel: string;
  timeLabel: string;
  availableSeats: number;
  status: string;
};

export const DIAS_EN_TIRA = 7;

/** Identifica una ruta origen→destino sin chocar con nombres que tengan guiones. */
export function claveRuta(from: string, to: string) {
  return `${from}\u001f${to}`;
}

export type DiaConSalidas = { key: string; label: string; count: number };

/** Días con salidas para la ruta elegida, en orden y con el conteo que se muestra en cada botón. */
export function diasConSalidas(salidas: SalidaOption[]): DiaConSalidas[] {
  const mapa = new Map<string, DiaConSalidas>();
  for (const salida of salidas) {
    const actual = mapa.get(salida.dayKey);
    if (actual) actual.count += 1;
    else mapa.set(salida.dayKey, { key: salida.dayKey, label: salida.dayLabel, count: 1 });
  }
  return [...mapa.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** El día elegido si todavía tiene salidas; si no, el primero disponible. */
export function diaEfectivo(dias: DiaConSalidas[], elegido: string): string {
  if (elegido && dias.some((dia) => dia.key === elegido)) return elegido;
  return dias[0]?.key ?? "";
}

/**
 * Los próximos días con salidas. Si el operador eligió una fecha lejana en el calendario, ese día
 * se agrega primero: lo seleccionado no puede quedar fuera de la tira.
 */
export function tiraDeDias(dias: DiaConSalidas[], efectivo: string, limite = DIAS_EN_TIRA): DiaConSalidas[] {
  const primeros = dias.slice(0, limite);
  if (!efectivo || primeros.some((dia) => dia.key === efectivo)) return primeros;
  const elegido = dias.find((dia) => dia.key === efectivo);
  return elegido ? [elegido, ...primeros] : primeros;
}
