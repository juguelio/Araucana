import type { Prisma } from "@prisma/client";
import { airportServiceWindow } from "@/lib/airport/service-window";
import { prisma } from "@/lib/db/prisma";
import { recorridosDeNave, type FuentesDeRecorridos } from "@/lib/vehicles/ficha";
import { inicioDeHoyArgentina, type ServicioDeNave } from "@/lib/vehicles/servicio-en-curso";


const ruta = { select: { id: true, from: true, to: true } } as const;

/**
 * Qué salidas cuentan como servicio de una nave: en la ventana pedida, no canceladas y **de una ruta
 * activa**. Sin lo último, el tablero mostraba servicios de rutas desactivadas (p. ej. Hua Hum) como si
 * la nave estuviera en la calle.
 */
export function salidasVigentes(desde: Date, hasta: Date): Prisma.ScheduleWhereInput {
  return { departureAt: { gte: desde, lt: hasta }, status: { not: "CANCELLED" }, route: { isActive: true } };
}

/**
 * Los servicios de toda la flota desde hoy y por `dias` días, agrupados por nave: con esto el tablero
 * muestra el próximo servicio y cuántos tiene hoy cada unidad, con cinco consultas en total (no cinco
 * por nave, como la ficha). Se descartan las salidas, viajes y días de Chapelco cancelados.
 */
export async function cargarServiciosDeLaFlota(ahora: Date = new Date(), dias = 60): Promise<Map<string, ServicioDeNave[]>> {
  const { dia, desde } = inicioDeHoyArgentina(ahora);
  const hasta = new Date(desde.getTime() + dias * 86400000);
  // Chapelco guarda el día como medianoche UTC.
  const diaDesde = new Date(`${dia}T00:00:00Z`);
  const diaHasta = new Date(diaDesde.getTime() + dias * 86400000);

  const [salidas, unidadesExtra, viajesEspeciales, aeropuerto, chapelco] = await Promise.all([
    prisma.schedule.findMany({
      where: salidasVigentes(desde, hasta),
      select: { id: true, vehicleId: true, routeId: true, departureAt: true, arrivalAt: true, status: true, route: ruta }
    }),
    prisma.scheduleUnit.findMany({
      where: { schedule: salidasVigentes(desde, hasta) },
      select: {
        id: true,
        vehicleId: true,
        schedule: { select: { id: true, routeId: true, departureAt: true, arrivalAt: true, status: true, route: ruta } }
      }
    }),
    prisma.specialTripAssignment.findMany({
      where: { startsAt: { lt: hasta }, endsAt: { gte: desde }, trip: { status: { not: "CANCELLED" } } },
      select: { id: true, vehicleId: true, startsAt: true, endsAt: true, trip: { select: { id: true, client: true, status: true, passengers: true } } }
    }),
    prisma.airportVehicleAssignment.findMany({
      // Desde 3 horas antes de hoy: un arribo de anoche puede seguir repartiendo pasajeros.
      where: { flight: { scheduledAt: { gte: new Date(desde.getTime() - 3 * 3600000), lt: hasta } } },
      select: {
        id: true,
        vehicleId: true,
        flight: {
          select: {
            id: true, number: true, airline: true, origin: true, destination: true, direction: true, scheduledAt: true, status: true,
            estimatedAt: true, pickupStartInitialAt: true, pickupStartOverrideAt: true
          }
        }
      }
    }),
    prisma.chapelcoVehicleDuty.findMany({
      where: { status: "ACTIVE", operationDay: { serviceDate: { gte: diaDesde, lt: diaHasta }, status: { not: "CANCELLED" } } },
      select: { id: true, vehicleId: true, status: true, capacity: true, operationDay: { select: { serviceDate: true, route: ruta } } }
    })
  ]);

  const porNave = new Map<string, FuentesDeRecorridos>();
  const de = (vehicleId: string) => {
    let fuentes = porNave.get(vehicleId);
    if (!fuentes) {
      fuentes = { salidas: [], unidadesExtra: [], viajesEspeciales: [], aeropuerto: [], chapelco: [] };
      porNave.set(vehicleId, fuentes);
    }
    return fuentes;
  };
  for (const salida of salidas) if (salida.vehicleId) de(salida.vehicleId).salidas.push(salida);
  for (const unidad of unidadesExtra) de(unidad.vehicleId).unidadesExtra.push(unidad);
  for (const viaje of viajesEspeciales) de(viaje.vehicleId).viajesEspeciales.push(viaje);
  for (const asignacion of aeropuerto) de(asignacion.vehicleId).aeropuerto.push(asignacion);
  for (const turno of chapelco) de(turno.vehicleId).chapelco.push(turno);

  const ventanas = new Map<string, { desde: Date; hasta: Date }>();
  for (const salida of salidas) ventanas.set(`SALIDA:${salida.id}`, { desde: salida.departureAt, hasta: salida.arrivalAt });
  for (const unidad of unidadesExtra) ventanas.set(`SALIDA_EXTRA:${unidad.id}`, { desde: unidad.schedule.departureAt, hasta: unidad.schedule.arrivalAt });
  for (const viaje of viajesEspeciales) ventanas.set(`VIAJE_ESPECIAL:${viaje.id}`, { desde: viaje.startsAt, hasta: viaje.endsAt });
  for (const asignacion of aeropuerto) {
    const ventana = airportServiceWindow({ ...asignacion.flight, status: asignacion.flight.status ?? undefined });
    ventanas.set(`AEROPUERTO:${asignacion.id}`, { desde: ventana.startsAt, hasta: ventana.endsAt });
  }

  const resultado = new Map<string, ServicioDeNave[]>();
  for (const [vehicleId, fuentes] of porNave) {
    // recorridosDeNave los deja del más nuevo al más viejo; el tablero los quiere en orden de salida.
    const lista = recorridosDeNave(fuentes)
      .map((recorrido) => ({ ...recorrido, ventana: ventanas.get(recorrido.key) ?? null }))
      .sort((a, b) => a.desde.getTime() - b.desde.getTime());
    resultado.set(vehicleId, lista);
  }
  return resultado;
}

export type SenalDelChofer = { minutos: number; detenido: boolean; chofer: string | null };

/**
 * La última ubicación que mandó cada chofer desde su celular (app del chofer), por nave, si llegó en
 * los últimos `minutos`. Es la otra mitad del cruce: lo programado dice dónde debería estar la nave;
 * la señal, que alguien la está manejando.
 */
export async function cargarSenalesDeChoferes(ahora: Date = new Date(), minutos = 20): Promise<Map<string, SenalDelChofer>> {
  const ubicaciones = await prisma.driverVehicleLocation.findMany({
    where: { recordedAt: { gte: new Date(ahora.getTime() - minutos * 60000) } },
    orderBy: { recordedAt: "desc" },
    select: { vehicleId: true, recordedAt: true, isStopped: true, driver: { select: { name: true } } }
  });
  const porNave = new Map<string, SenalDelChofer>();
  for (const ubicacion of ubicaciones) {
    if (porNave.has(ubicacion.vehicleId)) continue; // vienen de la más nueva a la más vieja
    porNave.set(ubicacion.vehicleId, {
      minutos: Math.max(0, Math.round((ahora.getTime() - ubicacion.recordedAt.getTime()) / 60000)),
      detenido: ubicacion.isStopped,
      chofer: ubicacion.driver.name?.trim() || null
    });
  }
  return porNave;
}
