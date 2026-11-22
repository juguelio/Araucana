import { prisma } from "@/lib/db/prisma";
import {
  alertasDeJornadas,
  armarJornadas,
  fechaLocal,
  resumirDia,
  rangoDelDia,
  type MuestraDeJornada,
  type ResumenDelDia
} from "./jornada";

/**
 * Lectura del día para el resumen operativo. Separado de `jornada.ts` (que es puro y se testea sin
 * base) por la misma razón que el mapa: la cuenta se puede probar, la consulta se puede medir.
 */

/** Tope de filas que se traen del historial de un día. A 3 s por reporte, 10 unidades dan ~290k. */
export const MAX_MUESTRAS_DIA = 120_000;

export type DiaDeFlota = ResumenDelDia & {
  fecha: string;
  /** true si se alcanzó el tope de filas: el resumen queda incompleto y la pantalla lo dice. */
  truncado: boolean;
  /** Total de unidades activas en el padrón, para comparar «3 de 8 unidades con actividad». */
  flotaTotal?: number;
};

export async function cargarDiaDeFlota(fecha: string, opciones: { ahora?: Date } = {}): Promise<DiaDeFlota | null> {
  const rango = rangoDelDia(fecha);
  if (!rango) return null;

  const ahora = opciones.ahora ?? new Date();
  const esHoy = fecha === fechaLocal(ahora);

  const [filas, flotaTotal] = await Promise.all([
    prisma.driverLocationSample.findMany({
      where: { recordedAt: { gte: rango.desde, lt: rango.hasta } },
      select: {
        driverId: true,
        vehicleId: true,
        latitude: true,
        longitude: true,
        recordedAt: true,
        isStopped: true,
        stoppedDurationSeconds: true,
        reportedSpeedKmh: true,
        inferredSpeedKmh: true,
        driver: { select: { name: true } },
        vehicle: { select: { name: true, internalNumber: true } }
      },
      orderBy: { recordedAt: "asc" },
      take: MAX_MUESTRAS_DIA
    }),
    prisma.vehicle.count({ where: { isActive: true } })
  ]);

  const muestras: MuestraDeJornada[] = filas.map((fila) => ({
    driverId: fila.driverId,
    driverName: fila.driver?.name ?? null,
    vehicleId: fila.vehicleId,
    vehicleName: fila.vehicle?.name ?? "",
    internalNumber: fila.vehicle?.internalNumber ?? null,
    latitude: fila.latitude,
    longitude: fila.longitude,
    recordedAt: fila.recordedAt,
    isStopped: fila.isStopped,
    stoppedDurationSeconds: fila.stoppedDurationSeconds,
    reportedSpeedKmh: fila.reportedSpeedKmh,
    inferredSpeedKmh: fila.inferredSpeedKmh
  }));

  const resumen = resumirDia(muestras, { ahora, esHoy });

  return {
    ...resumen,
    fecha,
    truncado: filas.length >= MAX_MUESTRAS_DIA,
    flotaTotal
  };
}

/** Días con algún reporte, para no ofrecer un calendario lleno de fechas vacías. */
export async function diasConActividad(limite = 14): Promise<string[]> {
  const filas = await prisma.$queryRaw<Array<{ dia: Date }>>`
    SELECT DISTINCT date_trunc('day', "recordedAt" + interval '-3 hours')::date AS dia
    FROM "DriverLocationSample"
    ORDER BY dia DESC
    LIMIT ${limite}
  `;
  return filas.map((fila) => fila.dia.toISOString().slice(0, 10));
}

/** Reexportado para que la pantalla no importe dos módulos sólo por las alertas. */
export { alertasDeJornadas, armarJornadas };
