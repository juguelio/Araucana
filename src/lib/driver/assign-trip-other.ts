import type { Prisma } from "@prisma/client";
import { recordEntityAudit } from "@/lib/audit/entity";
import { CHAPELCO_BOOKING_MODE, chapelcoActiveReservationStatuses } from "@/lib/chapelco/constants";
import { addChapelcoVehicleDuty } from "@/lib/chapelco/repository";
import { prisma } from "@/lib/db/prisma";
import { leerTurno } from "@/lib/school-runs/dia";
import { etiquetaDeConcesion } from "@/lib/school-runs/kinds";
import { conflictKey, dayInterval, driverConflicts, fleetConflicts, recordAcceptance, type FleetConflict } from "@/lib/special-trips/conflicts";
import { legSchema, localDateTime, localInput } from "@/lib/special-trips/data";
import { claveDe, etiquetaRango, ocupacionDelViaje, ultimoDia, whereNoTerminado, whereVigenteEn } from "@/lib/special-trips/rango";
import type { AssignTripInput, AssignTripResult, PendingTrip } from "./assign-trip-types";
import { schoolTripConflicts, schoolTripWindow } from "./school-trip-conflicts";

const unavailable = { error: "El viaje ya no está pendiente para ese día. Actualizá el listado." };
const summary = "Nave y chofer asignados desde Choferes.";
type Window = { startsAt: Date; endsAt: Date };

function pendingSpecial(serviceDate: Date, upcoming = false): Prisma.SpecialTripWhereInput {
  const dates = upcoming ? whereNoTerminado(serviceDate) : whereVigenteEn(serviceDate);
  return { ...dates, status: { in: ["PENDING", "CONFIRMED"] }, assignments: { none: {} } };
}

const chapelcoRoute = { bookingMode: CHAPELCO_BOOKING_MODE, specialType: "CHAPELCO", isActive: true };

function chapelcoBookings(serviceDate: Date | { gte: Date }): Prisma.ReservationWhereInput {
  return { bookingMode: CHAPELCO_BOOKING_MODE, status: { in: [...chapelcoActiveReservationStatuses] }, chapelcoDetails: { serviceDate } };
}

function pendingChapelco(serviceDate: Date): Prisma.TravelRouteWhereInput {
  return {
    ...chapelcoRoute,
    OR: [
      { directReservations: { some: chapelcoBookings(serviceDate) } },
      { chapelcoOperationDays: { some: { serviceDate } } }
    ],
    chapelcoOperationDays: { none: { serviceDate, OR: [
      { status: "CANCELLED" }, { vehicleDuties: { some: { status: "ACTIVE" } } }
    ] } }
  };
}

function specialWindow(trip: { serviceDate: Date; endDate: Date | null; legs: Prisma.JsonValue }): Window {
  const first = claveDe(trip.serviceDate);
  const last = claveDe(ultimoDia(trip));
  const { start, end } = ocupacionDelViaje(first, last);
  const fallback = { startsAt: new Date(start + ":00-03:00"), endsAt: new Date(end + ":00-03:00") };
  let departure: Date | null = null;
  let arrival: Date | null = null;
  for (const value of Array.isArray(trip.legs) ? trip.legs : []) {
    const leg = legSchema.safeParse(value).data;
    if (!leg) continue;
    // Los tramos interiores no acortan la ocupación de un viaje de varios días.
    if (leg.departure.slice(0, 10) === first) {
      const at = localDateTime(leg.departure, leg.zone);
      if (at && (!departure || at < departure)) departure = at;
    }
    if (leg.arrival.slice(0, 10) === last) {
      const at = localDateTime(leg.arrival, leg.arrivalZone ?? leg.zone);
      if (at && (!arrival || at > arrival)) arrival = at;
    }
  }
  const startsAt = departure ?? (arrival && arrival <= fallback.startsAt ? dayInterval(first).startsAt : fallback.startsAt);
  const endsAt = arrival ?? (departure && departure >= fallback.endsAt ? dayInterval(last).endsAt : fallback.endsAt);
  return endsAt > startsAt ? { startsAt, endsAt } : fallback;
}

export async function listPendingOtherTrips(day: string, upcoming = false): Promise<PendingTrip[]> {
  const serviceDate = new Date(day + "T00:00:00Z");
  const range = upcoming ? { gte: serviceDate } : serviceDate;
  const [special, schools, chapelco] = await Promise.all([
    prisma.specialTrip.findMany({
      where: pendingSpecial(serviceDate, upcoming),
      select: { id: true, client: true, destinationSearch: true, serviceDate: true, endDate: true, legs: true }
    }),
    prisma.schoolRun.findMany({
      where: { serviceDate: range, vehicleId: null },
      select: { id: true, serviceDate: true, routeName: true, kind: true, shift: true, driver: { select: { name: true, email: true } } }
    }),
    prisma.travelRoute.findMany({
      where: chapelcoRoute,
      select: {
        id: true, from: true, to: true,
        directReservations: { where: chapelcoBookings(range), select: { chapelcoDetails: { select: { serviceDate: true, ascentSlot: true } } } },
        chapelcoOperationDays: { where: { serviceDate: range }, select: {
          serviceDate: true, status: true, _count: { select: { vehicleDuties: { where: { status: "ACTIVE" } } } }
        } }
      }
    })
  ]);
  return [
    ...special.map((trip): PendingTrip => {
      const { startsAt, endsAt } = specialWindow(trip);
      const hours = `${localInput(startsAt).slice(11)} a ${localInput(endsAt).slice(11)}`;
      const detail = [trip.destinationSearch.trim().replace(/\s*\n\s*/g, " · "), etiquetaRango(trip, serviceDate), hours].filter(Boolean).join(" · ");
      return { kind: "special", day: trip.serviceDate < serviceDate ? day : claveDe(trip.serviceDate), id: trip.id, service: "Viaje especial", title: trip.client, startsAt: +startsAt, detail };
    }),
    ...schools.map((run): PendingTrip => {
      const day = claveDe(run.serviceDate);
      return {
        kind: "school", day, id: run.id, service: "Concesiones", title: run.routeName,
        detail: [etiquetaDeConcesion(run.kind), leerTurno(run.shift).etiqueta,
          run.driver ? `Chofer actual: ${run.driver.name || run.driver.email}` : null].filter(Boolean).join(" · "),
        startsAt: schoolTripWindow(day, run.shift)?.startsAt.getTime() ?? +dayInterval(day).startsAt
      };
    }),
    ...chapelco.flatMap((route): PendingTrip[] => {
      // El primer pasajero ya genera un viaje pendiente aunque aún no se haya abierto el día de operación.
      const days = new Map<string, string | null>();
      for (const { chapelcoDetails: booking } of route.directReservations) {
        if (!booking) continue;
        const day = claveDe(booking.serviceDate);
        const first = days.get(day);
        if (!first || booking.ascentSlot < first) days.set(day, booking.ascentSlot);
      }
      for (const operation of route.chapelcoOperationDays) {
        const day = claveDe(operation.serviceDate);
        if (operation.status === "CANCELLED" || operation._count.vehicleDuties > 0) days.delete(day);
        else if (!days.has(day)) days.set(day, null);
      }
      return Array.from(days, ([day, slot]) => ({
        kind: "chapelco", day, id: route.id, service: "Chapelco", title: `${route.from} → ${route.to}`,
        detail: slot ? `Primer ascenso ${slot}` : "Operación del día",
        startsAt: slot ? +new Date(`${day}T${slot}:00-03:00`) : +dayInterval(day).startsAt
      }));
    })
  ];
}

async function checkCrew(
  tx: Prisma.TransactionClient, input: AssignTripInput, window: Window | null, schoolShift?: string
): Promise<Exclude<AssignTripResult, { saved: true }> | { accepted: FleetConflict[] }> {
  const { driverId, vehicleId, kind, id, day } = input;
  const school = schoolShift === undefined ? undefined : { id, shift: schoolShift };
  const [vehicles, drivers, schools] = await Promise.all([
    window ? fleetConflicts(tx, { ...window, vehicleId }) : [],
    window ? driverConflicts(tx, { ...window, driverId }) : [],
    schoolTripConflicts(tx, { ...(window ?? dayInterval(day)), driverId, vehicleId }, school)
  ]);
  // La ocupación de Chapelco es por día. En una concesión con turno nombrado tampoco se conoce la hora exacta.
  const approximate = kind === "chapelco" || (school !== undefined && leerTurno(school.shift).minutos === null);
  const external = [...vehicles, ...drivers].map(hit => approximate ? { ...hit, possible: true } : hit);
  const conflicts = [...external, ...schools.map(hit => kind === "chapelco" ? { ...hit, possible: true } : hit)];
  const busy = conflicts.filter(hit => hit.subject === "driver" && !hit.possible);
  if (busy.length) return { error: "El chofer ya está asignado a esa hora. " + busy.map(hit => hit.label).join(" · ") };
  const confirmation = conflictKey(conflicts, [kind, id, day, vehicleId, driverId, window, schoolShift]);
  if (conflicts.length && confirmation !== input.confirmation) return { conflicts, confirmation };
  return { accepted: conflicts };
}

export async function assignOtherTrip(tx: Prisma.TransactionClient, input: AssignTripInput): Promise<AssignTripResult> {
  const { kind, id, day, driverId, vehicleId, actor } = input;
  const serviceDate = new Date(day + "T00:00:00Z");
  const crew = { driverId, vehicleId };
  if (kind === "school") {
    const run = await tx.schoolRun.findFirst({
      where: { id, serviceDate, vehicleId: null },
      select: { id: true, routeName: true, shift: true, driverId: true, revision: true }
    });
    if (!run) return unavailable;
    const result = await checkCrew(tx, input, schoolTripWindow(day, run.shift), run.shift);
    if (!("accepted" in result)) return result;
    const saved = await tx.schoolRun.updateMany({
      where: { id, revision: run.revision, vehicleId: null }, data: { ...crew, revision: { increment: 1 } }
    });
    if (!saved.count) return unavailable;
    await recordAcceptance(tx, "SCHOOL_RUN", id, actor.id, result.accepted);
    await recordEntityAudit(tx, { actor, entity: "SCHOOL_RUN", entityId: id, entityLabel: run.routeName, action: "UPDATE", summary,
      before: { vehicleId: null, driverId: run.driverId }, after: crew });
    return { saved: true };
  }
  if (kind === "special") {
    const trip = await tx.specialTrip.findFirst({
      where: { id, ...pendingSpecial(serviceDate) }, select: { serviceDate: true, endDate: true, legs: true, client: true, updatedAt: true }
    });
    if (!trip) return unavailable;
    const window = specialWindow(trip);
    const result = await checkCrew(tx, input, window);
    if (!("accepted" in result)) return result;
    // La ficha de especiales también usa updatedAt: una edición abierta detecta esta asignación.
    const touched = await tx.specialTrip.updateMany({ where: { id, updatedAt: trip.updatedAt, assignments: { none: {} } },
      data: { updatedAt: new Date(Math.max(Date.now(), +trip.updatedAt + 1)) } });
    if (!touched.count) return unavailable;
    await tx.specialTripAssignment.create({ data: { tripId: id, ...crew, ...window } });
    await recordAcceptance(tx, "SPECIAL", id, actor.id, result.accepted);
    await recordEntityAudit(tx, { actor, entity: "SPECIAL_TRIP", entityId: id, entityLabel: trip.client, action: "UPDATE", summary, after: { ...crew, ...window } });
    return { saved: true };
  }
  if (kind !== "chapelco") return unavailable;
  const route = await tx.travelRoute.findFirst({ where: { id, ...pendingChapelco(serviceDate) }, select: { id: true } });
  if (!route) return unavailable;
  const capacity = await tx.seat.count({ where: { vehicleId } });
  if (capacity < 1 || capacity > 80) return { error: "Elegí una nave con entre 1 y 80 asientos configurados para Chapelco." };
  const result = await checkCrew(tx, input, dayInterval(day));
  if (!("accepted" in result)) return result;
  const operation = await tx.chapelcoOperationDay.upsert({
    where: { routeId_serviceDate: { routeId: id, serviceDate } }, create: { routeId: id, serviceDate }, update: {}
  });
  const current = await tx.chapelcoVehicleDuty.findUnique({
    where: { operationDayId_vehicleId: { operationDayId: operation.id, vehicleId } }, select: { notes: true }
  });
  const duty = await addChapelcoVehicleDuty({ operationDayId: operation.id, ...crew, capacity, notes: current?.notes }, tx);
  await recordAcceptance(tx, "CHAPELCO", duty.id, actor.id, result.accepted);
  await recordEntityAudit(tx, { actor, entity: "CHAPELCO", entityId: operation.id, entityLabel: `Chapelco · ${day}`,
    action: "UPDATE", summary, after: { ...crew, capacity } });
  return { saved: true };
}
