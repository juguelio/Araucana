import { prisma } from "@/lib/db/prisma";
import { recorridosDeNave, type FuentesDeRecorridos, type Recorrido } from "@/lib/vehicles/ficha";

const ruta = { select: { id: true, from: true, to: true } } as const;

/** Inicio del día de hoy en Argentina (UTC-3, sin horario de verano). */
export function inicioDeHoyArgentina(ahora: Date = new Date()) {
  const dia = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).format(ahora);
  return { dia, desde: new Date(`${dia}T00:00:00-03:00`) };
}

/**
 * Los servicios de toda la flota desde hoy y por `dias` días, agrupados por nave: con esto el tablero
 * muestra el próximo servicio y cuántos tiene hoy cada unidad, con cinco consultas en total (no cinco
 * por nave, como la ficha). Se descartan las salidas, viajes y días de Chapelco cancelados.
 */
export async function cargarServiciosDeLaFlota(ahora: Date = new Date(), dias = 60): Promise<Map<string, Recorrido[]>> {
  const { dia, desde } = inicioDeHoyArgentina(ahora);
  const hasta = new Date(desde.getTime() + dias * 86400000);
  // Chapelco guarda el día como medianoche UTC.
  const diaDesde = new Date(`${dia}T00:00:00Z`);
  const diaHasta = new Date(diaDesde.getTime() + dias * 86400000);

  const [salidas, unidadesExtra, viajesEspeciales, aeropuerto, chapelco] = await Promise.all([
    prisma.schedule.findMany({
      where: { departureAt: { gte: desde, lt: hasta }, status: { not: "CANCELLED" } },
      select: { id: true, vehicleId: true, routeId: true, departureAt: true, arrivalAt: true, status: true, route: ruta }
    }),
    prisma.scheduleUnit.findMany({
      where: { schedule: { departureAt: { gte: desde, lt: hasta }, status: { not: "CANCELLED" } } },
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
      where: { flight: { scheduledAt: { gte: desde, lt: hasta } } },
      select: {
        id: true,
        vehicleId: true,
        flight: { select: { id: true, number: true, airline: true, origin: true, destination: true, direction: true, scheduledAt: true, status: true } }
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
  for (const salida of salidas) de(salida.vehicleId).salidas.push(salida);
  for (const unidad of unidadesExtra) de(unidad.vehicleId).unidadesExtra.push(unidad);
  for (const viaje of viajesEspeciales) de(viaje.vehicleId).viajesEspeciales.push(viaje);
  for (const asignacion of aeropuerto) de(asignacion.vehicleId).aeropuerto.push(asignacion);
  for (const turno of chapelco) de(turno.vehicleId).chapelco.push(turno);

  const resultado = new Map<string, Recorrido[]>();
  for (const [vehicleId, fuentes] of porNave) {
    // recorridosDeNave los deja del más nuevo al más viejo; el tablero los quiere en orden de salida.
    resultado.set(vehicleId, recorridosDeNave(fuentes).sort((a, b) => a.desde.getTime() - b.desde.getTime()));
  }
  return resultado;
}

/** El próximo servicio que todavía no salió, y cuántos tiene hoy (los hechos y los que faltan). */
export function proximoYHoy(recorridos: Recorrido[] | undefined, ahora: Date = new Date()) {
  const { dia } = inicioDeHoyArgentina(ahora);
  const diaDe = (recorrido: Recorrido) =>
    recorrido.soloDia ? recorrido.desde.toISOString().slice(0, 10) : inicioDeHoyArgentina(recorrido.desde).dia;
  const lista = recorridos ?? [];
  const hoy = lista.filter((recorrido) => diaDe(recorrido) === dia).length;
  const proximo = lista.find((recorrido) => (recorrido.soloDia ? diaDe(recorrido) >= dia : recorrido.desde >= ahora)) ?? null;
  return { proximo, hoy, diaDe };
}
