/**
 * Días con salidas para el buscador público: la fecha vacía significa «todas».
 * Trabaja con la zona horaria de Salta, igual que el resto del sitio.
 */
const ZONA = "America/Argentina/Salta";

export type DiaConSalidas = { key: string; label: string; count: number };

/** Clave `YYYY-MM-DD` del día en Salta. */
export function claveDia(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function claveHoy() {
  return claveDia(new Date());
}

/** «sáb, 14 nov». */
export function etiquetaDia(date: Date) {
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: ZONA
  })
    .format(date)
    .replace(/\.$/, "");
}

export function horaDia(date: Date) {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: ZONA
  }).format(date);
}

/** Mediodía de la clave, para etiquetar una fecha que no vino con una salida. */
export function fechaDeClave(key: string) {
  return new Date(`${key}T12:00:00-03:00`);
}

/** Días que tienen al menos una salida, ordenados, con su etiqueta y el conteo. */
export function diasConSalidas(salidas: Date[]): DiaConSalidas[] {
  const porDia = new Map<string, DiaConSalidas>();

  for (const salida of salidas) {
    const key = claveDia(salida);
    const actual = porDia.get(key);

    if (actual) {
      actual.count += 1;
    } else {
      porDia.set(key, { key, label: etiquetaDia(salida), count: 1 });
    }
  }

  return [...porDia.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Los primeros `cuantos` días; si el elegido quedó afuera de la ventana, va adelante. */
export function tiraDeDias(dias: DiaConSalidas[], elegido: string, cuantos: number): DiaConSalidas[] {
  const primeros = dias.slice(0, cuantos);
  const diaElegido = elegido ? dias.find((dia) => dia.key === elegido) : undefined;

  return diaElegido && !primeros.some((dia) => dia.key === diaElegido.key) ? [diaElegido, ...primeros] : primeros;
}
