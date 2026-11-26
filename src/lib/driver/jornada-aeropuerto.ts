import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { horaEnSalta, retiroPaihuen, type ServiceOrderBlock } from "@/lib/airport/service-order";
import { airportPickupStart } from "@/lib/airport/pickup-start";
import { VUELOS_QUE_NO_SE_OFRECEN } from "@/lib/airport/offered-flights";
import { getAirportServiceOrder } from "@/lib/airport/service-order-data";
import { localDateKey } from "@/lib/operations/day-board";
import { cierreDelTraslado } from "./servicios-consulta";
import type { FilaApp, ServicioApp } from "./jornada-app-types";

export const camposDeNave = { id: true, name: true, internalNumber: true, licensePlate: true, isActive: true } as const;
export function naveApp(v: { id: string; name: string; internalNumber: string | null; licensePlate: string | null; isActive: boolean }) {
  if (v.isActive === false) return null;
  return { id: v.id, nombre: v.name, interno: v.internalNumber, patente: v.licensePlate };
}

export function pasajerosDeOrden(block: ServiceOrderBlock) {
  const repeticiones = new Map<string, number>();
  const lugares = new Set<string>();
  const filas = block.passengers.map((p): FilaApp => {
    // La clave privada nunca sale del servidor. Una reserva privada puede tener varias paradas.
    const base = createHash("sha256").update(JSON.stringify([p.code, block.privateOrderId ? p.lodging : null])).digest("hex");
    const indice = repeticiones.get(base) ?? 0;
    repeticiones.set(base, indice + 1);
    const lugar = [p.lodging, p.lodgingDetail].filter(Boolean).join(" · ");
    if (lugar && lugar !== "—") lugares.add(lugar);
    return { id: indice ? base + "-" + indice : base, nombre: p.name, cantidad: p.seats,
      detalle: [lugar, p.pickupNotes].filter(Boolean).join(" · "), telefono: p.contact || null };
  });
  return { filas, paradas: [...lugares] };
}

export type VentanaApp = Pick<ServicioApp, "id" | "fecha" | "salida" | "fin" | "nave">;
const ventanas = new Map<string, { vence: number; revision: string; servicios: ServicioApp[] }>();

export async function aeropuertoAsignado(driverId: string, desde: Date, hasta: Date, conHoja: boolean): Promise<ServicioApp[]> {
  // La salida de un vuelo de madrugada puede empezar la noche anterior.
  const diaAntes = new Date(+desde - 86400000);
  const diaDespues = new Date(+hasta + 86400000);
  const filtro = { status: { notIn: ["CANCELLED", "DIVERTED"] }, source: { not: "RETIRADO" }, number: { notIn: [...VUELOS_QUE_NO_SE_OFRECEN] } };
  const propios = await prisma.flight.findMany({
    where: { ...filtro, scheduledAt: { gte: diaAntes, lt: diaDespues }, assignments: { some: { driverId } } },
    select: { id: true, pickupGroupId: true }
  });
  if (!propios.length) return [];
  const grupos = propios.flatMap(f => f.pickupGroupId ? [f.pickupGroupId] : []);
  // Consultar todos los miembros para que el reparto por zona y la nave canónica coincidan con administración.
  const vuelos = await prisma.flight.findMany({
    where: { ...filtro, OR: [{ id: { in: propios.map(f => f.id) } }, { pickupGroupId: { in: grupos } }] },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    select: {
      id: true, number: true, direction: true, scheduledAt: true, estimatedAt: true, pickupGroupId: true,
      pickupStartInitialAt: true, pickupStartOverrideAt: true,
      assignments: { orderBy: { id: "asc" }, select: { id: true, driverId: true, privateReservationId: true, notes: conHoja, vehicle: { select: camposDeNave } } }
    }
  });
  const key = JSON.stringify([driverId, +desde, +hasta]);
  const revision = JSON.stringify(vuelos);
  const guardado = ventanas.get(key);
  if (!conHoja && guardado && guardado.revision === revision && guardado.vence > Date.now()) return guardado.servicios;

  const servicios: ServicioApp[] = [];
  const cubiertas = new Set<string>();
  const fechas = [...new Set(vuelos.map(f => localDateKey(f.scheduledAt)))];
  const ordenes = await Promise.all(fechas.map(fecha => getAirportServiceOrder(fecha, null, {
    incluirVacias: true, soloVuelosOperativos: true, soloRecorrido: !conHoja,
    vuelos: vuelos.map(f => f.id)
  })));
  for (const { blocks, oficina } of ordenes) {
    for (const block of blocks) {
      const unidad = block.vehicle;
      if (!unidad) continue;
      for (const vueloId of block.flightIds) cubiertas.add(vueloId + ":" + unidad.vehicleId);
      if (unidad.driverId !== driverId) continue;
      const asignacion = vuelos.flatMap(f => f.assignments).find(a => a.id === unidad.assignmentId && a.driverId === driverId);
      if (!asignacion) continue;
      const fin = cierreDelTraslado(block.operationAt, block.direction, block.scheduledAt);
      if (+block.operationAt >= +hasta || +fin <= +desde) continue;
      const hacia = block.direction === "DEPARTURE";
      const { filas, paradas } = conHoja ? pasajerosDeOrden(block) : { filas: [], paradas: [] };
      const primerRetiro = block.passengers[0];
      const saleDelRetiro = primerRetiro && (retiroPaihuen(primerRetiro) || block.privateOrderId || !oficina.point);
      const origen = hacia ? (saleDelRetiro ? paradas[0] ?? "" : oficina.address || oficina.label) : "Aeropuerto Chapelco";
      servicios.push({
        id: "orden-" + block.key, fecha: localDateKey(block.operationAt), tipo: "Aeropuerto",
        titulo: "Vuelo " + block.flightNumber + (hacia ? " · Hacia el aeropuerto" : " · Desde el aeropuerto"),
        salida: block.operationAt.toISOString(), fin: fin.toISOString(),
        origen,
        nave: naveApp(asignacion.vehicle), paradas: hacia ? [...paradas, "Aeropuerto Chapelco"] : paradas,
        indicaciones: [...(block.privateOrderId ? ["Traslado privado"] : []), ...(asignacion.notes ? [asignacion.notes] : []),
          ...block.flights.map(f => "Vuelo " + f.number + " · " + (hacia ? "Despegue " : "Arribo ") + horaEnSalta(f.flightAt))],
        filas, compartida: false
      });
    }
  }
  for (const vuelo of vuelos) {
    const salida = airportPickupStart(vuelo) ?? vuelo.estimatedAt ?? vuelo.scheduledAt;
    const fin = cierreDelTraslado(salida, vuelo.direction, vuelo.scheduledAt);
    if (+salida >= +hasta || +fin <= +desde) continue;
    for (const asignacion of vuelo.assignments) {
      if (asignacion.driverId !== driverId || cubiertas.has(vuelo.id + ":" + asignacion.vehicle.id)) continue;
      servicios.push({
        id: "vuelo-" + vuelo.id, fecha: localDateKey(salida), tipo: "Aeropuerto", titulo: "Vuelo " + vuelo.number,
        salida: salida.toISOString(), fin: fin.toISOString(), nave: naveApp(asignacion.vehicle),
        origen: vuelo.direction === "ARRIVAL" ? "Aeropuerto Chapelco" : "", paradas: [], filas: [],
        indicaciones: asignacion.notes ? [asignacion.notes] : [], compartida: false
      });
    }
  }
  if (!conHoja) {
    // Sólo ventanas operativas: sin nombres, paradas ni teléfonos. La asignación se verifica incluso durante el TTL.
    if (ventanas.size >= 128) ventanas.delete(ventanas.keys().next().value!);
    ventanas.set(key, { revision, servicios, vence: Date.now() + 30_000 });
  }
  return servicios;
}
