import { prisma } from "@/lib/db/prisma";
import { getAirportServiceOrder } from "@/lib/airport/service-order-data";
import { horaEnSalta, retiroPaihuen } from "@/lib/airport/service-order";
import { PAIHUEN_POINT } from "@/lib/airport/paihuen";
import { claveDeLugar } from "@/lib/booking/place-names";
import { localDateKey } from "@/lib/operations/day-board";
import { normalizeRouteSheetStops } from "./route-sheet";
import { cierreDelTraslado } from "./servicios-consulta";
import type { ServicioDelDia, UnidadDeServicio } from "./servicios";
import { distanciaAlSegmento, type PlanMapa, type Punto, type TramoPrevisto } from "./plan-mapa";
import caminos from "./data/caminos-patagonia.json";

// Referencias viales de OpenStreetMap (ODbL), obtenidas con OSRM de routing.openstreetmap.de.
// La capa se sirve localmente. Las coordenadas de retiros y teléfonos nunca salen al enrutador.
const sma = "san martin de los andes";
const angostura = "villa la angostura";
const corredores: { origen: string; destino: string; via: RegExp; camino: keyof typeof caminos }[] = [
  { origen: sma, destino: "villa traful", via: /40|7 lagos|siete lagos/, camino: "sma-traful" },
  { origen: angostura, destino: "villa traful", via: /40|65|7 lagos/, camino: "angostura-traful" },
  { origen: sma, destino: angostura, via: /40|7 lagos|siete lagos/, camino: "sma-angostura" },
  { origen: sma, destino: "hua hum", via: /48|yuco/, camino: "sma-hua-hum" }
];

function carreteraDeRuta(ruta: { from: string; to: string; via: string }) {
  const desde = claveDeLugar(ruta.from);
  const hasta = claveDeLugar(ruta.to);
  for (const c of corredores) {
    if (!c.via.test(claveDeLugar(ruta.via))) continue;
    if (c.origen === desde && c.destino === hasta) return camino(c.camino);
    if (c.destino === desde && c.origen === hasta) return camino(c.camino).reverse();
  }
  return [];
}

function unidad(u: UnidadDeServicio) {
  return { id: u.vehicleId, nombre: u.internalNumber ? `Interno ${u.internalNumber}` : u.vehicleName, chofer: u.driverName };
}

function base(s: ServicioDelDia): PlanMapa {
  return { id: s.id, titulo: s.titulo, salida: s.at?.getTime() ?? null, fin: s.endsAt?.getTime() ?? null,
    unidades: s.unidades.map(unidad), detalle: s.detalle ?? "", tramos: [], completo: false };
}

function camino(clave: keyof typeof caminos): Punto[] {
  return caminos[clave].map(([lat, lng]) => [lat, lng]);
}

// Une las paradas en el orden de la hoja y toma la carretera hacia el destino desde el acceso
// más cercano. La conexión al acceso y el reparto en ciudad son orientativos.
function traslado(paradas: Punto[], referencia: Punto[], vuelta: boolean): TramoPrevisto[] {
  if (!paradas.length) return [];
  const orden = vuelta ? [...paradas].reverse() : paradas;
  const ultima = orden[orden.length - 1];
  let acceso = 0;
  for (let i = 1; i < referencia.length; i++) {
    if (distanciaAlSegmento(ultima, referencia[i], referencia[i]) <
        distanciaAlSegmento(ultima, referencia[acceso], referencia[acceso])) acceso = i;
  }
  const tramos = [
    { puntos: [...orden, referencia[acceso]], vial: false },
    { puntos: referencia.slice(acceso), vial: true }
  ].filter(t => t.puntos.length >= 2);
  return vuelta ? tramos.reverse().map(t => ({ ...t, puntos: t.puntos.reverse() })) : tramos;
}

export async function cargarPlanesDelDia(fecha: string, servicios: ServicioDelDia[]): Promise<PlanMapa[]> {
  const diasDeVuelo = [...new Set([fecha, ...servicios.flatMap(s => s.fechaVuelo ? [s.fechaVuelo] : [])])];
  const [ordenes, rutas, ascensos, concesiones] = await Promise.all([
    Promise.all(diasDeVuelo.map(d => getAirportServiceOrder(d, null, { soloVuelosOperativos: true }))),
    prisma.travelRoute.findMany({ where: { id: { in: servicios.flatMap(s => s.rutaId ? [s.rutaId] : []) } },
      select: { id: true, from: true, to: true, via: true, stops: true } }),
    prisma.chapelcoRun.findMany({
      where: { operationDay: { serviceDate: new Date(fecha), status: { not: "CANCELLED" } }, vehicleDuty: { status: "ACTIVE" }, status: { not: "CANCELLED" } },
      select: { id: true, operationDayId: true, direction: true, ascentSlot: true, sequence: true,
        vehicleDuty: { select: { vehicle: { select: { id: true, name: true } }, driver: { select: { name: true } } } },
        stops: { orderBy: { stopOrder: "asc" }, select: { pickupLatitude: true, pickupLongitude: true } } }
    }),
    prisma.schoolRun.findMany({ where: { serviceDate: new Date(fecha) }, select: { id: true, routeName: true, shift: true,
      vehicle: { select: { id: true, name: true } }, driver: { select: { name: true } } } })
  ]);
  const planes: PlanMapa[] = [];
  const vuelosConOrden = new Set<string>();
  for (const { blocks, oficina } of ordenes) {
    for (const b of blocks) {
      if (localDateKey(b.operationAt) !== fecha) continue;
      for (const id of b.flightIds) vuelosConOrden.add(`vuelo-${id}`);
      const salida = b.direction === "DEPARTURE";
      const paradas: Punto[] = b.passengers.flatMap(p => p.pickup ? [[p.pickup.latitude, p.pickup.longitude] as Punto] : []);
      const paihuen = salida && b.passengers[0] && retiroPaihuen(b.passengers[0]);
      if (salida && paihuen && !b.passengers[0].pickup) paradas.unshift(PAIHUEN_POINT);
      else if (salida && !paihuen && oficina.point && paradas.length) paradas.unshift(oficina.point);
      planes.push({
        id: `orden-${b.key}`, titulo: `Vuelo ${b.flightNumber} · ${salida ? "hacia el aeropuerto" : "desde el aeropuerto"}`,
        detalle: salida ? `Vuelo ${horaEnSalta(b.scheduledAt)}` : "Reparto",
        salida: +b.operationAt, fin: +cierreDelTraslado(b.operationAt, b.direction, b.scheduledAt),
        unidades: b.vehicle ? [{ id: b.vehicle.vehicleId, nombre: b.vehicle.name, chofer: b.vehicle.driver }] : [],
        tramos: traslado(paradas, camino("sma-aeropuerto"), !salida),
        completo: b.passengers.length > 0 && b.passengers.every(p => p.pickup)
      });
    }
  }
  for (const s of servicios) {
    if (vuelosConOrden.has(s.id)) continue;
    const plan = base(s);
    if (s.area === "ESPECIAL") {
      for (const [i, u] of s.unidades.entries()) {
        if (u.inicioAsignado && localDateKey(u.inicioAsignado) === fecha)
          planes.push({ ...plan, id: `${s.id}-${i}`, salida: +u.inicioAsignado, fin: u.finAsignado?.getTime() ?? null, unidades: [unidad(u)] });
      }
      continue;
    }
    if (s.area === "CHAPELCO" && ascensos.some(r => s.id === `chapelco-${r.operationDayId}`)) continue;
    const ruta = rutas.find(r => r.id === s.rutaId);
    if (ruta) {
      plan.detalle = ruta.via;
      const paradas = normalizeRouteSheetStops(ruta.stops);
      const puntos: Punto[] = paradas.flatMap(p => p.latitude !== null && p.longitude !== null &&
        Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 ? [[p.latitude, p.longitude] as Punto] : []);
      if (puntos.length >= 2) {
        plan.tramos = [{ puntos, vial: false }];
        plan.completo = puntos.length === paradas.length;
      } else {
        const carretera = carreteraDeRuta(ruta);
        if (carretera.length) {
          plan.tramos = [{ puntos: carretera, vial: true }];
          plan.completo = true;
        }
      }
    }
    planes.push(plan);
  }
  for (const r of ascensos) {
    const subida = r.direction === "UP";
    const salida = subida && r.ascentSlot ? Date.parse(`${fecha}T${r.ascentSlot}:00-03:00`) : null;
    planes.push({ id: `vuelta-${r.id}`, titulo: `Chapelco · ${subida ? "Ascenso" : "Descenso"} ${r.sequence}`,
      detalle: "", salida, fin: salida === null ? null : salida + 90 * 60000,
      unidades: [{ id: r.vehicleDuty.vehicle.id, nombre: r.vehicleDuty.vehicle.name, chofer: r.vehicleDuty.driver?.name ?? null }],
      tramos: traslado(r.stops.map(p => [p.pickupLatitude, p.pickupLongitude]), camino("sma-cerro"), !subida),
      completo: false });
  }
  for (const c of concesiones) planes.push({ id: c.id, titulo: c.routeName, detalle: c.shift, salida: null, fin: null,
    unidades: c.vehicle ? [{ id: c.vehicle.id, nombre: c.vehicle.name, chofer: c.driver?.name ?? null }] : [], tramos: [], completo: false });
  return planes.sort((a, b) => (a.salida ?? Infinity) - (b.salida ?? Infinity) || a.titulo.localeCompare(b.titulo, "es"));
}
