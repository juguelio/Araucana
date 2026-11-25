import { prisma } from "@/lib/db/prisma";

/**
 * Mapa en vivo de la flota (issue #316): la ubicación que manda la app del chofer ya se guardaba en
 * `DriverVehicleLocation` y no tenía ningún consumidor del lado admin. Esta capa es la lectura.
 *
 * Se separa en dos mitades, como el resto del repo: una función pura que arma el estado
 * (`armarFlotaEnVivo`, testeable sin base) y la consulta (`cargarFlotaEnVivo`).
 */

/**
 * Cuántos minutos vale una posición como señal viva. Pasado ese rato la nave **no desaparece**: se
 * muestra «sin señal» con la última posición conocida y cuánto hace que no reporta. Que una unidad
 * se caiga del mapa sin explicación es lo que hace desconfiar de la pantalla.
 */
export const VENTANA_SENAL_MINUTOS = 10;

export type EstadoDeNaveEnVivo = "en-movimiento" | "detenida" | "sin-senal";

export type NaveEnVivo = {
  servicioId?: string | null;
  vehicleId: string;
  vehicleName: string;
  internalNumber: string | null;
  licensePlate: string | null;
  driverId: string;
  driverName: string | null;
  latitude: number;
  longitude: number;
  /** ISO: el instante que reportó el teléfono del chofer. */
  recordedAt: string;
  minutosDesdeLaSenal: number;
  estado: EstadoDeNaveEnVivo;
  speedKmh: number | null;
  heading: number | null;
  accuracy: number | null;
  isStopped: boolean;
  stoppedDurationSeconds: number;
};

export type ChoferSinUbicacion = {
  driverId: string;
  driverName: string | null;
};

export type FlotaEnVivo = {
  actualizadoEn: string;
  ventanaMinutos: number;
  /** Naves con posición conocida (vivas y con señal vieja), primero las que están reportando. */
  naves: NaveEnVivo[];
  /** Choferes activos que todavía no mandaron ninguna posición. */
  sinUbicacion: ChoferSinUbicacion[];
};

export type UbicacionCruda = {
  servicioId?: string | null;
  driverId: string;
  vehicleId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  reportedSpeedKmh: number | null;
  inferredSpeedKmh: number | null;
  isStopped: boolean;
  stoppedDurationSeconds: number;
  recordedAt: Date;
  driver: { name: string | null };
  vehicle: { name: string; internalNumber: string | null; licensePlate: string | null };
};

export type ChoferActivo = { id: string; name: string | null };

const ORDEN_ESTADO: Record<EstadoDeNaveEnVivo, number> = {
  "en-movimiento": 0,
  detenida: 1,
  "sin-senal": 2
};

export function minutosDesdeLaSenal(recordedAt: Date, ahora: Date) {
  return Math.max(0, Math.floor((ahora.getTime() - recordedAt.getTime()) / 60000));
}

/**
 * Una nave está «sin señal» sólo cuando la última posición supera la ventana; justo en el límite
 * todavía cuenta como viva. El estado lo decide la posición (no al revés): así una unidad detenida
 * hace 40 minutos no se lee como «detenida», que sonaría a que está ahí mismo esperando.
 */
export function estadoDeNaveEnVivo(
  senal: { minutos: number; isStopped: boolean },
  ventanaMinutos: number = VENTANA_SENAL_MINUTOS
): EstadoDeNaveEnVivo {
  if (senal.minutos > ventanaMinutos) return "sin-senal";
  return senal.isStopped ? "detenida" : "en-movimiento";
}

function velocidadKmh(ubicacion: UbicacionCruda): number | null {
  const velocidad = ubicacion.reportedSpeedKmh ?? ubicacion.inferredSpeedKmh;
  return velocidad == null ? null : Math.round(velocidad * 10) / 10;
}

export function armarFlotaEnVivo(
  ubicaciones: UbicacionCruda[],
  choferesActivos: ChoferActivo[],
  ahora: Date,
  ventanaMinutos: number = VENTANA_SENAL_MINUTOS
): FlotaEnVivo {
  const naves: NaveEnVivo[] = ubicaciones.map((ubicacion) => {
    const minutos = minutosDesdeLaSenal(ubicacion.recordedAt, ahora);
    return {
      servicioId: ubicacion.servicioId ?? null,
      vehicleId: ubicacion.vehicleId,
      vehicleName: ubicacion.vehicle.name,
      internalNumber: ubicacion.vehicle.internalNumber,
      licensePlate: ubicacion.vehicle.licensePlate,
      driverId: ubicacion.driverId,
      driverName: ubicacion.driver.name?.trim() || null,
      latitude: ubicacion.latitude,
      longitude: ubicacion.longitude,
      recordedAt: ubicacion.recordedAt.toISOString(),
      minutosDesdeLaSenal: minutos,
      estado: estadoDeNaveEnVivo({ minutos, isStopped: ubicacion.isStopped }, ventanaMinutos),
      speedKmh: velocidadKmh(ubicacion),
      heading: ubicacion.heading,
      accuracy: ubicacion.accuracy,
      isStopped: ubicacion.isStopped,
      stoppedDurationSeconds: ubicacion.stoppedDurationSeconds
    };
  });

  naves.sort(
    (a, b) =>
      ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] ||
      (a.internalNumber ?? a.vehicleName).localeCompare(b.internalNumber ?? b.vehicleName, "es")
  );

  const conUbicacion = new Set(ubicaciones.map((ubicacion) => ubicacion.driverId));
  const sinUbicacion = choferesActivos
    .filter((chofer) => !conUbicacion.has(chofer.id))
    .map((chofer) => ({ driverId: chofer.id, driverName: chofer.name?.trim() || null }))
    .sort((a, b) => (a.driverName ?? "").localeCompare(b.driverName ?? "", "es"));

  return {
    actualizadoEn: ahora.toISOString(),
    ventanaMinutos,
    naves,
    sinUbicacion
  };
}

export async function cargarFlotaEnVivo(ahora: Date = new Date()): Promise<FlotaEnVivo> {
  const [ubicaciones, choferes] = await Promise.all([
    prisma.driverVehicleLocation.findMany({
      select: {
        servicioId: true,
        driverId: true,
        vehicleId: true,
        latitude: true,
        longitude: true,
        accuracy: true,
        heading: true,
        speed: true,
        reportedSpeedKmh: true,
        inferredSpeedKmh: true,
        isStopped: true,
        stoppedDurationSeconds: true,
        recordedAt: true,
        driver: { select: { name: true } },
        vehicle: { select: { name: true, internalNumber: true, licensePlate: true } }
      }
    }),
    prisma.user.findMany({
      where: { role: "DRIVER", isActive: true },
      select: { id: true, name: true }
    })
  ]);

  return armarFlotaEnVivo(ubicaciones, choferes, ahora);
}
