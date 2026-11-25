import type { Prisma } from "@prisma/client";
import type { AuditActor } from "@/lib/audit/record";
import { recordEntityAudit } from "@/lib/audit/entity";
import { formatAuditDate } from "@/lib/audit/labels";
import { conflictKey, dayInterval, driverConflicts, lockFleet, recordAcceptance, specialConflicts, type FleetConflict } from "@/lib/special-trips/conflicts";
import { localInput } from "@/lib/special-trips/data";
import { companerosDeRecorrida, vuelosDeLaRecorrida } from "./pickup-group";
import { airportVehicleBusy, assignPrivateVehicle } from "./private-vehicle";
import { airportServiceWindow } from "./service-window";

export type FleetSaveResult = { day: string; message: string } | { error: string } | { conflicts: FleetConflict[]; confirmation: string };

type Actor = AuditActor & { id: string };

type FleetRequest = {
  flightId: string;
  vehicleId: string;
  /** Omitido conserva el chofer existente. null lo quita. */
  driverId?: string | null;
  privateReservationId?: string;
  assignmentId?: string;
  previousDriverId?: string;
  previousVehicleId?: string;
  confirmation: string;
  additionalConflicts?: FleetConflict[];
  /** Miembros operativos completos que se relevaron dentro de la transacción de Choferes. */
  pendingFlights?: Awaited<ReturnType<typeof vuelosDeLaRecorrida>>;
};

/** "AR 1656 · 16/11/2026, 14:30": cómo se nombra un vuelo en la auditoría. */
export function flightLabel(flight: { number: string; scheduledAt: Date }) {
  return `${flight.number} · ${formatAuditDate(flight.scheduledAt)}`;
}

async function guardarCombiPrivada(tx: Prisma.TransactionClient, actor: Actor,
  request: FleetRequest, reservationId: string, vehicleId: string, driverId: string | null): Promise<FleetSaveResult> {
  const detalle = await tx.airportReservationDetails.findUnique({
    where: { reservationId },
    include: { flight: true, reservation: { select: { status: true, shortCode: true, privateAirportVehicles: true } } }
  });
  const flight = detalle?.flight;
  if (!detalle?.isPrivate || !flight || flight.id !== request.flightId || detalle.reservation.status === "CANCELLED") {
    return { error: "La reserva privada ya no está activa en este vuelo." };
  }
  if (request.pendingFlights && detalle.reservation.privateAirportVehicles.length) {
    return { error: "El traslado privado ya tiene una nave asignada." };
  }
  const assignmentId = request.assignmentId ?? "";
  const anterior = detalle.reservation.privateAirportVehicles.find(a => a.id === assignmentId);
  if ((anterior?.id ?? "") !== assignmentId || (anterior?.driverId ?? "") !== (request.previousDriverId ?? "") ||
      (request.previousVehicleId !== undefined && (anterior?.vehicleId ?? "") !== request.previousVehicleId)) {
    return { error: "La asignación privada cambió. Actualizá el tablero antes de guardar." };
  }
  if (driverId && driverId !== anterior?.driverId &&
      !await tx.user.findFirst({ where: { id: driverId, role: "DRIVER", isActive: true }, select: { id: true } })) {
    return { error: "Elegí un chofer activo." };
  }
  const driverHits = driverId && !["CANCELLED", "DIVERTED"].includes(flight.status)
    ? await driverConflicts(tx, { driverId, ...airportServiceWindow(flight) }, { flightId: flight.id, vehicleId: anterior?.vehicleId ?? vehicleId })
    : [];
  const conflicts = [...new Map([...driverHits, ...(request.additionalConflicts ?? [])].map(hit => [hit.id, hit])).values()];
  const confirmation = conflictKey(conflicts, [reservationId, vehicleId, driverId]);
  if (conflicts.length && request.confirmation !== confirmation) return { conflicts, confirmation };

  // Si falla la asignación de reemplazo, la transacción conserva la nave y el chofer anteriores.
  let asignacion;
  if (anterior?.vehicleId === vehicleId) {
    asignacion = await tx.airportVehicleAssignment.update({ where: { id: anterior.id }, data: { driverId } });
  } else {
    asignacion = await assignPrivateVehicle(tx, reservationId, flight, 1, vehicleId, driverId, anterior?.id);
  }
  await recordAcceptance(tx, "AIRPORT", asignacion.id, actor.id, conflicts);
  const message = `Asignación privada guardada para ${detalle.reservation.shortCode}.`;
  await recordEntityAudit(tx, { actor, entity: "AIRPORT", entityId: flight.id, entityLabel: flightLabel(flight),
    action: anterior ? "UPDATE" : "CREATE", summary: message,
    before: anterior ? { vehicleId: anterior.vehicleId, driverId: anterior.driverId } : null, after: { reservationId, vehicleId, driverId } });
  return { day: localInput(flight.scheduledAt).slice(0, 10), message };
}

/** La misma operación transaccional para el tablero de aeropuerto y la asignación desde Choferes. */
export async function saveAirportFleet(tx: Prisma.TransactionClient, user: Actor, request: FleetRequest): Promise<FleetSaveResult> {
  const { flightId, vehicleId, driverId: requestedDriver } = request;
  const sendsDriver = requestedDriver !== undefined;
  await lockFleet(tx, [vehicleId]);
  const privada = request.privateReservationId;
  if (privada) return guardarCombiPrivada(tx, user, request, privada, vehicleId, requestedDriver ?? null);
  const flight = await tx.flight.findUnique({ where: { id: flightId } });
  if (!flight) return { error: "El vuelo ya no existe." };
  // La recorrida es la unidad con la que se asigna la flota: la hoja del chofer une en una sola orden a
  // los vuelos que comparten camioneta, así que si se asigna a un vuelo suelto el grupo queda con dos
  // naves y vuelve a partirse en silencio.
  const previous = await tx.airportVehicleAssignment.findUnique({
    where: { flightId_vehicleId: { flightId, vehicleId } }, select: { driverId: true, privateReservationId: true }
  });
  if (previous?.privateReservationId) return { error: "Esta nave está reservada para un traslado privado." };
  const recorrida = request.pendingFlights ?? await vuelosDeLaRecorrida(tx, flight);
  if (request.pendingFlights && await tx.airportVehicleAssignment.count({
    where: { flightId: { in: recorrida.map(member => member.id) }, privateReservationId: null }
  })) return { error: "La recorrida ya tiene una nave asignada." };
  // Los otros vuelos de la recorrida que todavía no tienen esta combi (por ejemplo, se juntaron después).
  const companeros = recorrida.filter((vuelo) => vuelo.id !== flight.id);
  if (await airportVehicleBusy(tx, vehicleId,
    [flight, ...companeros.map(other => ({ ...flight, ...other }))], false)) {
    return { error: "Esta nave está reservada para un traslado privado." };
  }
  const yaLaTienen = companeros.length
    ? await tx.airportVehicleAssignment.findMany({ where: { flightId: { in: companeros.map((vuelo) => vuelo.id) }, vehicleId }, select: { flightId: true } })
    : [];
  const faltan = companeros.filter((vuelo) => !yaLaTienen.some((tiene) => tiene.flightId === vuelo.id));
  const driverId = sendsDriver ? requestedDriver ?? null : previous?.driverId ?? null;
  const driverChanged = driverId !== (previous?.driverId ?? null);
  // Re-guardar lo mismo no hace nada, salvo que a algún vuelo de la recorrida todavía le falte la combi.
  if (previous && !driverChanged && faltan.length === 0) return { error: "La combi ya tenía ese chofer." };
  if (driverId && driverChanged && !(await tx.user.findFirst({ where: { id: driverId, role: "DRIVER", isActive: true }, select: { id: true } }))) {
    return { error: "Ese chofer no está disponible: elegí un chofer activo." };
  }

  const active = !["CANCELLED", "DIVERTED"].includes(flight.status);
  // La nave se controla al sumarla; al cambiar sólo el chofer, ya estaba en el vuelo.
  const days = new Set([flight.scheduledAt, flight.estimatedAt, flight.pickupStartOverrideAt ?? flight.pickupStartInitialAt]
    .flatMap((date) => date ? [localInput(date).slice(0, 10)] : []));
  const vehicleHits = active && !previous && !request.pendingFlights ? (await Promise.all(
    [...days].map((day) => specialConflicts(tx, { vehicleId, ...dayInterval(day) }, undefined, true))
  )).flat() : [];
  const driverHits = active && driverId && driverChanged
    ? await driverConflicts(tx, { driverId, ...airportServiceWindow(flight) }, { flightId, vehicleId, sameTrip: await companerosDeRecorrida(tx, flight) })
    : [];
  const conflicts = [...new Map([...vehicleHits, ...driverHits, ...(request.additionalConflicts ?? [])].map((hit) => [hit.id, hit])).values()];
  const confirmation = conflictKey(conflicts, [flightId, vehicleId, driverId]);
  if (conflicts.length && request.confirmation !== confirmation) return { conflicts, confirmation };

  const assignment = await tx.airportVehicleAssignment.upsert({
    where: { flightId_vehicleId: { flightId, vehicleId } },
    update: { driverId },
    create: { flightId, vehicleId, driverId }
  });
  await recordAcceptance(tx, "AIRPORT", assignment.id, user.id, conflicts);
  // El resto de la recorrida lleva la misma combi y el mismo chofer: es una sola vuelta. Desde el
  // tablero llega sólo la nave (`sinChofer`): ahí no se pisa el chofer que el vuelo ya tenía, para no
  // borrar una asignación que el operador cargó a mano.
  for (const companero of companeros) {
    await tx.airportVehicleAssignment.upsert({
      where: { flightId_vehicleId: { flightId: companero.id, vehicleId } },
      update: sendsDriver ? { driverId } : {},
      create: { flightId: companero.id, vehicleId, driverId }
    });
  }
  const [vehicle, drivers] = await Promise.all([
    tx.vehicle.findUnique({ where: { id: vehicleId }, select: { name: true } }),
    tx.user.findMany({ where: { id: { in: [previous?.driverId, driverId].filter((d): d is string => !!d) } }, select: { id: true, name: true, email: true } })
  ]);
  const driverName = (driver: string | null | undefined) => {
    const found = drivers.find((item) => item.id === driver);
    return found ? found.name ?? found.email : null;
  };
  const vehicleName = vehicle?.name ?? vehicleId;
  const chofer = driverId ? driverName(driverId) : null;
  await recordEntityAudit(tx, {
    actor: user, entity: "AIRPORT", entityId: flightId, entityLabel: flightLabel(flight),
    action: previous ? "UPDATE" : "CREATE",
    summary: !previous ? `Combi ${vehicleName} asignada al vuelo.`
      : driverId ? `Chofer de la combi ${vehicleName} cambiado en el vuelo.` : `Chofer de la combi ${vehicleName} quitado del vuelo.`,
    before: previous ? { vehicle: vehicleName, driver: driverName(previous.driverId) } : null,
    after: { vehicle: vehicleName, driver: chofer }
  });
  for (const companero of faltan) {
    await recordEntityAudit(tx, {
      actor: user, entity: "AIRPORT", entityId: companero.id, entityLabel: flightLabel(companero),
      action: "CREATE", summary: `Combi ${vehicleName} asignada a la recorrida de ${flightLabel(flight)}.`,
      before: null, after: { vehicle: vehicleName, driver: chofer }
    });
  }
  const recorridaNombre = recorrida.map((vuelo) => vuelo.number).join(" + ");
  // Con la recorrida unida el aviso nombra los vuelos: el operador tiene que poder ver qué hizo la
  // asignación más allá del vuelo donde la cargó.
  const message = recorrida.length > 1
    ? `Combi ${vehicleName} y ${chofer ? `chofer ${chofer}` : "sin chofer"} en la recorrida ${recorridaNombre}.`
    : !previous ? "Combi asignada al vuelo." : driverId ? "Chofer asignado a la combi." : "Chofer quitado de la combi.";
  return { day: localInput(flight.scheduledAt).slice(0, 10), message };
}
