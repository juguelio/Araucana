import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { dayRange, localDateKey, shiftDateKey } from "@/lib/operations/day-board";
import { legSchema, pointsForLeg, tripContactLabel } from "@/lib/special-trips/data";
import { leerTurno } from "@/lib/school-runs/dia";
import { registroAnteriorChapelco } from "@/lib/chapelco/registro-manifiesto";
import { lugarDeTerminal } from "@/lib/booking/terminals";
import { normalizeRouteSheetStops, routeSheetOrder } from "./route-sheet";
import { aeropuertoAsignado, camposDeNave, naveApp, type VentanaApp } from "./jornada-aeropuerto";
import type { FilaApp, JornadaApp, ServicioApp } from "./jornada-app-types";

const datosPasajero = { firstName: true, lastName: true, phone: true } as const;
const nombre = (p: { firstName: string; lastName: string }) => [p.firstName, p.lastName].filter(Boolean).join(" ");
const textos = (valores: (string | null | undefined)[]) => valores.filter((v): v is string => Boolean(v?.trim()));

async function serviciosPublicos(driverId: string, desde: Date, hasta: Date, conHoja: boolean): Promise<ServicioApp[]> {
  const consulta = {
    where: { departureAt: { lt: hasta }, arrivalAt: { gt: desde }, status: { not: "CANCELLED" },
      route: { bookingMode: "SEATED", isActive: true }, OR: [{ driverId }, { extraUnits: { some: { driverId } } }] },
    select: {
      id: true, departureAt: true, arrivalAt: true, driverId: true, vehicle: { select: camposDeNave },
      route: { select: { from: true, to: true, via: true, stops: conHoja } },
      extraUnits: { where: { driverId }, select: { vehicle: { select: camposDeNave } } },
      _count: { select: { extraUnits: true } },
      reservations: { where: { status: { in: ["PENDING_PAYMENT", "CONFIRMED"] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, passengerCount: true, boardingStop: true, dropoffStop: true, passenger: { select: datosPasajero } } }
    }
  } satisfies Prisma.ScheduleFindManyArgs;
  const salidas = conHoja ? await prisma.schedule.findMany(consulta) :
    (await prisma.schedule.findMany({ ...consulta, select: { ...consulta.select, reservations: false } }))
      .map(s => ({ ...s, reservations: [] }));
  return salidas.flatMap(s => {
    const unidades = [...(s.driverId === driverId ? [s.vehicle] : []), ...s.extraUnits.map(u => u.vehicle)];
    const paradas = normalizeRouteSheetStops(s.route.stops);
    const orden = routeSheetOrder(s.reservations.map(r => ({ reserva: r, name: nombre(r.passenger), stop: r.dropoffStop ?? "" })), paradas);
    const filas = orden.map(({ reserva: r, name }) => ({ id: r.id, nombre: name, cantidad: r.passengerCount,
      detalle: [r.boardingStop || s.route.from, r.dropoffStop || s.route.to].map(lugarDeTerminal).join(" → "),
      telefono: r.passenger.phone || null }));
    const origen = lugarDeTerminal(s.route.from);
    return unidades.map(u => ({
      id: "salida-" + s.id, fecha: localDateKey(s.departureAt), tipo: "Servicio Público", titulo: s.route.from + " → " + s.route.to,
      salida: s.departureAt.toISOString(), fin: s.arrivalAt.toISOString(), origen, nave: naveApp(u),
      paradas: [...new Set([origen, ...paradas.map(p => lugarDeTerminal(p.name)), lugarDeTerminal(s.route.to)])], indicaciones: textos([s.route.via]),
      filas, compartida: s._count.extraUnits > 0
    }));
  });
}

async function serviciosEspeciales(driverId: string, desde: Date, hasta: Date, conHoja: boolean): Promise<ServicioApp[]> {
  const consulta = {
    where: { driverId, startsAt: { lt: hasta }, endsAt: { gt: desde }, trip: { status: { not: "CANCELLED" } } },
    select: { id: true, startsAt: true, endsAt: true, vehicle: { select: camposDeNave },
      trip: { select: { client: true, contact: conHoja, contactName: conHoja, contactPhone: conHoja, passengers: true,
        destinationSearch: true, notes: conHoja, legs: conHoja,
        _count: { select: { assignments: true } },
        departureSheets: { orderBy: { kind: "asc" }, select: {
          passengers: { orderBy: [{ position: "asc" }, { id: "asc" }], select: {
            id: true, firstName: true, lastName: true, documentType: true, documentNumber: true
          } }
        } }
      } }
    }
  } satisfies Prisma.SpecialTripAssignmentFindManyArgs;
  const asignaciones = conHoja ? await prisma.specialTripAssignment.findMany(consulta) :
    (await prisma.specialTripAssignment.findMany({ ...consulta, select: { ...consulta.select,
      trip: { select: { ...consulta.select.trip.select, departureSheets: false } }
    } })).map(a => ({ ...a, trip: { ...a.trip, departureSheets: [] } }));
  return asignaciones.map(a => {
    const t = a.trip;
    const tramos = (Array.isArray(t.legs) ? t.legs : []).flatMap(v => {
      const leg = legSchema.safeParse(v);
      return leg.success ? [leg.data] : [];
    });
    const manifiesto = new Map<string, FilaApp>();
    for (const planilla of t.departureSheets ?? []) {
      for (const p of planilla.passengers) {
        const documento = p.documentType + "-" + p.documentNumber;
        if (!manifiesto.has(documento)) manifiesto.set(documento, { id: p.id, nombre: nombre(p), cantidad: 1, detalle: "", telefono: null });
      }
    }
    const paradas = tramos.flatMap(l => textos([l.origin, ...pointsForLeg(l).map(p => p.name), l.destination]));
    return {
      id: "especial-" + a.id, fecha: localDateKey(a.startsAt), tipo: "Especial", titulo: "Viaje especial · " + t.client,
      salida: a.startsAt.toISOString(), fin: a.endsAt.toISOString(), origen: tramos[0]?.origin ?? "",
      nave: naveApp(a.vehicle), paradas: paradas.length ? paradas : textos([t.destinationSearch]),
      indicaciones: textos([t.passengers === null ? null : t.passengers + " pasajeros previstos",
        conHoja ? tripContactLabel(t) : null, t.notes, ...tramos.map(l => l.description)]),
      filas: [...manifiesto.values()], compartida: t._count.assignments > 1
    };
  });
}

async function serviciosChapelco(driverId: string, rango: { gte: Date; lt: Date }, conHoja: boolean): Promise<ServicioApp[]> {
  const consulta = {
    where: { driverId, status: "ACTIVE", operationDay: { serviceDate: rango, status: { not: "CANCELLED" } } },
    select: { vehicle: { select: camposDeNave }, notes: conHoja,
      operationDay: { select: { id: true, serviceDate: true, route: { select: { from: true, to: true } } } },
      runs: { where: { status: { not: "CANCELLED" } }, orderBy: { sequence: "asc" },
        select: { id: true, direction: true, ascentSlot: true, sequence: true,
          stops: { where: { reservation: { status: { not: "CANCELLED" } } }, orderBy: { stopOrder: "asc" }, select: {
            id: true, pickupName: true, pickupAddress: true, passengerCount: true, status: true, driverNotes: true,
            reservation: { select: { passenger: { select: datosPasajero } } }
          } }
        } }
    }
  } satisfies Prisma.ChapelcoVehicleDutyFindManyArgs;
  const vueltas = consulta.select.runs;
  const guardias = conHoja ? await prisma.chapelcoVehicleDuty.findMany(consulta) :
    (await prisma.chapelcoVehicleDuty.findMany({ ...consulta, select: { ...consulta.select,
      runs: { ...vueltas, select: { ...vueltas.select, stops: false } }
    } })).map(g => ({ ...g, runs: g.runs.map(r => ({ ...r, stops: [] })) }));
  return guardias.flatMap(g => {
    const dia = g.operationDay;
    const fecha = dia.serviceDate.toISOString().slice(0, 10);
    const base: ServicioApp = { id: "chapelco-" + dia.id, tipo: "Chapelco", fecha,
      titulo: "Chapelco · " + dia.route.from + " → " + dia.route.to, origen: dia.route.from,
      nave: naveApp(g.vehicle), paradas: [], indicaciones: textos([g.notes]), filas: [], compartida: false, salida: null, fin: null };
    if (!g.runs.length) return [base];
    return g.runs.map(r => {
      const subida = r.direction === "UP";
      const inicio = subida && r.ascentSlot ? Date.parse(fecha + "T" + r.ascentSlot + ":00-03:00") : NaN;
      const filas = (r.stops ?? []).map(p => ({
        id: p.id, nombre: nombre(p.reservation.passenger), cantidad: p.passengerCount,
        registroAnterior: registroAnteriorChapelco(p.status, p.passengerCount),
        detalle: textos([p.pickupName, p.pickupAddress, p.driverNotes]).join(" · "), telefono: p.reservation.passenger.phone || null
      }));
      return { ...base, id: "vuelta-" + r.id, titulo: "Chapelco · " + (subida ? "Ascenso " : "Descenso ") + r.sequence,
        origen: subida ? dia.route.from : dia.route.to, salida: Number.isFinite(inicio) ? new Date(inicio).toISOString() : null,
        filas, paradas: [...new Set((r.stops ?? []).map(p => textos([p.pickupName, p.pickupAddress]).join(" · ")))],
        fin: null
      };
    });
  });
}

async function concesiones(driverId: string, rango: { gte: Date; lt: Date }): Promise<ServicioApp[]> {
  const servicios = await prisma.schoolRun.findMany({
    where: { driverId, serviceDate: rango },
    select: { id: true, routeName: true, serviceDate: true, shift: true, companion: true, notes: true, vehicle: { select: camposDeNave } }
  });
  return servicios.map(s => {
    const fecha = s.serviceDate.toISOString().slice(0, 10);
    const turno = leerTurno(s.shift);
    // Los turnos con nombre son franjas de planificación, no un horario de viaje confirmado.
    const salida = turno.minutos === null ? null : new Date(+dayRange(fecha).from + turno.minutos * 60000).toISOString();
    return { id: s.id, fecha, tipo: "Concesiones", titulo: s.routeName, salida, fin: null, origen: "",
      nave: s.vehicle && naveApp(s.vehicle), paradas: [], indicaciones: textos([s.shift, s.companion && "Acompañante: " + s.companion, s.notes]),
      filas: [], compartida: false };
  });
}

async function serviciosAsignados(driverId: string, fecha: string, dias: number, conHoja: boolean): Promise<ServicioApp[]> {
  const siguiente = shiftDateKey(fecha, dias);
  const desde = dayRange(fecha).from;
  const hasta = dayRange(siguiente).from;
  const rango = { gte: new Date(fecha), lt: new Date(siguiente) };
  const grupos = await Promise.all([
    serviciosPublicos(driverId, desde, hasta, conHoja), aeropuertoAsignado(driverId, desde, hasta, conHoja),
    serviciosEspeciales(driverId, desde, hasta, conHoja), serviciosChapelco(driverId, rango, conHoja), concesiones(driverId, rango)
  ]);
  // Un servicio que atraviesa medianoche figura cada día que efectivamente se solapa, conservando su intervalo real.
  return grupos.flat().flatMap(s => {
    const primerDia = s.fecha < fecha ? fecha : s.fecha;
    if (!s.fin) return [s];
    const ultimoDia = localDateKey(new Date(Date.parse(s.fin) - 1));
    const instancias: ServicioApp[] = [];
    for (let dia = primerDia; dia <= ultimoDia && dia < siguiente; dia = shiftDateKey(dia, 1)) instancias.push({ ...s, fecha: dia });
    return instancias;
  }).sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.salida ? Date.parse(a.salida) : Infinity) - (b.salida ? Date.parse(b.salida) : Infinity) || a.id.localeCompare(b.id));
}

export async function cargarJornadaApp(driverId: string, fecha = localDateKey(new Date()), dias = 7): Promise<JornadaApp> {
  return { fecha, servicios: await serviciosAsignados(driverId, fecha, dias, true) };
}

export async function cargarVentanasGpsApp(driverId: string, fecha = localDateKey(new Date()), dias = 1): Promise<VentanaApp[]> {
  const servicios = await serviciosAsignados(driverId, fecha, dias, false);
  return servicios.map(({ id, fecha, salida, fin, nave }) => ({ id, fecha, salida, fin, nave }));
}
