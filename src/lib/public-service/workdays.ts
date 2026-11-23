import { argentinaDateKey } from "@/lib/booking/admin-filters";

/** Una salida con chofer asignado: lo mínimo para contar días, salidas y horas trabajadas. */
export type SalidaConChofer = {
  driverId: string | null;
  driverName: string | null;
  departureAt: Date;
  arrivalAt: Date;
};

export type ResumenChofer = {
  driverId: string;
  driverName: string;
  /** Días distintos con al menos una salida (clave argentina YYYY-MM-DD). */
  dias: string[];
  salidas: number;
  horas: number;
  primerHora: string | null;
  ultimaHora: string | null;
};

const horaFormatter = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Salta"
});

/**
 * Días y horas de cada chofer a partir de sus salidas. Es la base para liquidar: no inventa un
 * valor de hora ni un plus, sólo cuenta lo que efectivamente tiene asignado en las salidas.
 */
export function resumenPorChofer(salidas: SalidaConChofer[]): ResumenChofer[] {
  const porChofer = new Map<string, ResumenChofer>();

  for (const salida of salidas) {
    if (!salida.driverId) continue;
    const actual = porChofer.get(salida.driverId) ?? {
      driverId: salida.driverId,
      driverName: salida.driverName?.trim() || salida.driverId,
      dias: [],
      salidas: 0,
      horas: 0,
      primerHora: null,
      ultimaHora: null
    };

    const dia = argentinaDateKey(salida.departureAt);
    if (!actual.dias.includes(dia)) actual.dias.push(dia);
    actual.salidas += 1;
    actual.horas += Math.max(0, salida.arrivalAt.getTime() - salida.departureAt.getTime()) / 3_600_000;

    const hora = horaFormatter.format(salida.departureAt);
    if (!actual.primerHora || hora < actual.primerHora) actual.primerHora = hora;
    const horaFin = horaFormatter.format(salida.arrivalAt);
    if (!actual.ultimaHora || horaFin > actual.ultimaHora) actual.ultimaHora = horaFin;

    porChofer.set(salida.driverId, actual);
  }

  return [...porChofer.values()]
    .map((chofer) => ({ ...chofer, dias: [...chofer.dias].sort(), horas: Math.round(chofer.horas * 10) / 10 }))
    .sort((a, b) => b.dias.length - a.dias.length || a.driverName.localeCompare(b.driverName, "es"));
}

export function formatoHoras(horas: number): string {
  return `${horas.toLocaleString("es-AR", { maximumFractionDigits: 1 })} h`;
}
