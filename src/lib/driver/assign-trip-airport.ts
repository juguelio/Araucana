import type { Prisma } from "@prisma/client";
import { saveAirportFleet } from "@/lib/airport/fleet-assignment";
import { vuelosParaElTablero } from "@/lib/airport/flight-board";
import { horaEfectivaDelVuelo } from "@/lib/airport/effective-time";
import { VUELOS_QUE_NO_SE_OFRECEN } from "@/lib/airport/offered-flights";
import { airportPickupStart } from "@/lib/airport/pickup-start";
import { airportServiceWindow } from "@/lib/airport/service-window";
import { BookingError } from "@/lib/booking/repository";
import { prisma } from "@/lib/db/prisma";
import { dayRange, localDateKey } from "@/lib/operations/day-board";
import { driverConflicts, fleetConflicts } from "@/lib/special-trips/conflicts";
import { schoolTripConflicts } from "./school-trip-conflicts";
import type { AssignTripInput, AssignTripResult, PendingTrip } from "./assign-trip-types";

const flightSelect = {
  id: true, number: true, direction: true, source: true, status: true, lastCheckedAt: true,
  scheduledAt: true, estimatedAt: true, pickupStartInitialAt: true, pickupStartOverrideAt: true, pickupGroupId: true,
  assignments: { select: { privateReservationId: true } },
  reservations: {
    where: { reservation: { status: { not: "CANCELLED" } } },
    select: { isPrivate: true, reservationId: true, reservation: { select: { shortCode: true, passengerCount: true } } }
  }
} satisfies Prisma.FlightSelect;

type RunFlight = Prisma.FlightGetPayload<{ select: typeof flightSelect }>;
type PendingRun = { trip: PendingTrip; flights: RunFlight[] };

function operationAt(flight: RunFlight) {
  return airportPickupStart(flight) ?? horaEfectivaDelVuelo(flight);
}

function pendingRuns(flights: RunFlight[], day: string, upcoming: boolean): PendingRun[] {
  const includesDay = (operationDay: string) => upcoming ? operationDay >= day : operationDay === day;
  const runs: PendingRun[] = [];
  const groups = new Map<string, RunFlight[]>();
  const byDay = new Map<string, RunFlight[]>();
  for (const flight of flights) {
    if (flight.source === "ESTIMADO" && !flight.reservations.length && !flight.assignments.length) continue;
    const date = localDateKey(flight.scheduledAt);
    const sameDay = byDay.get(date) ?? [];
    sameDay.push(flight);
    byDay.set(date, sameDay);
  }
  for (const sameDay of byDay.values()) {
    const { tablero, fantasma } = vuelosParaElTablero(sameDay);
    const visible = [...tablero, ...fantasma.filter(f => f.reservations.length || f.assignments.length)]
      .filter(f => !["CANCELLED", "DIVERTED"].includes(f.status));
    const visibleFlights = new Set(visible.map(f => f.id));
    const visibleGroups = new Set(visible.map(f => f.pickupGroupId ?? f.id));
    for (const flight of sameDay) {
      const key = flight.pickupGroupId ?? flight.id;
      if (!visibleGroups.has(key) || ["CANCELLED", "DIVERTED"].includes(flight.status)) continue;
      const group = groups.get(key) ?? [];
      group.push(flight);
      groups.set(key, group);
      const startsAt = +operationAt(flight);
      const operationDay = localDateKey(new Date(startsAt));
      if (!visibleFlights.has(flight.id) || !includesDay(operationDay)) continue;
      for (const detail of flight.reservations) {
        if (!detail.isPrivate || flight.assignments.some(a => a.privateReservationId === detail.reservationId)) continue;
        const reservation = detail.reservation;
        runs.push({ flights: [flight], trip: {
          id: detail.reservationId, kind: "private", service: "Aeropuerto privado",
          title: `${flight.number} · ${reservation.shortCode}`,
          detail: `${directionLabel(flight)} · ${reservation.passengerCount} pax`,
          startsAt, day: operationDay
        } });
      }
    }
  }
  for (const [id, members] of groups) {
    if (members.some(f => f.assignments.some(a => !a.privateReservationId))) continue;
    const passengers = members.flatMap(f => f.reservations);
    if (passengers.length && passengers.every(r => r.isPrivate)) continue;
    const startsAt = Math.min(...members.map(f => +operationAt(f)));
    const operationDay = localDateKey(new Date(startsAt));
    if (!includesDay(operationDay)) continue;
    const count = passengers.reduce((sum, r) => sum + (r.isPrivate ? 0 : r.reservation.passengerCount), 0);
    runs.push({ flights: members, trip: {
      id, kind: "airport", service: "Aeropuerto", day: operationDay,
      title: members.map(f => f.number).join(" + "), detail: `${directionLabel(members[0])} · ${count} pax`, startsAt
    } });
  }
  return runs;
}

function directionLabel(flight: RunFlight) {
  const tramo = flight.direction === "DEPARTURE" ? "Alojamientos → Aeropuerto Chapelco" : "Aeropuerto Chapelco → alojamientos";
  return flight.source === "REVISAR" ? `${tramo} · Revisar vuelo` : tramo;
}

async function readPendingRuns(client: Pick<Prisma.TransactionClient, "flight">, day: string, upcoming = false) {
  const { from, to } = dayRange(day);
  const range = { gte: from, lt: upcoming ? undefined : to };
  // Las recogidas de vuelos de madrugada pueden empezar el día anterior. Leer los días completos
  // también permite aplicar las mismas reglas de proyecciones y recorridas que el tablero del aeropuerto.
  const adjacentDays = { gte: new Date(+from - 86_400_000), lt: upcoming ? undefined : new Date(+to + 86_400_000) };
  const flights = await client.flight.findMany({
    where: {
      source: { not: "RETIRADO" },
      number: { notIn: [...VUELOS_QUE_NO_SE_OFRECEN] },
      OR: [{ scheduledAt: adjacentDays }, { estimatedAt: range }, { pickupStartOverrideAt: range }, { pickupStartInitialAt: range }]
    },
    select: flightSelect, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }]
  });
  // Una estima que se corrió varios días puede traer un solo miembro de una fecha lejana. Los
  // grupos se coordinan por fecha programada: completamos esos días antes de decidir si tienen nave.
  const distantFlights = flights.filter(f => f.scheduledAt < adjacentDays.gte || (adjacentDays.lt && f.scheduledAt >= adjacentDays.lt));
  if (!distantFlights.length) return pendingRuns(flights, day, upcoming);
  const otherDays = new Set(distantFlights.map(f => localDateKey(f.scheduledAt)));
  const rest = await client.flight.findMany({
    where: {
      source: { not: "RETIRADO" },
      id: { notIn: distantFlights.map(f => f.id) }, number: { notIn: [...VUELOS_QUE_NO_SE_OFRECEN] },
      OR: [...otherDays].map(date => {
        const { from, to } = dayRange(date);
        return { scheduledAt: { gte: from, lt: to } };
      })
    },
    select: flightSelect, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }]
  });
  return pendingRuns([...flights, ...rest].sort((a, b) => +a.scheduledAt - +b.scheduledAt || a.id.localeCompare(b.id)), day, upcoming);
}

export async function listPendingAirportTrips(day: string, upcoming = false): Promise<PendingTrip[]> {
  return (await readPendingRuns(prisma, day, upcoming)).map(run => run.trip);
}

export async function assignAirportTrip(tx: Prisma.TransactionClient, input: AssignTripInput): Promise<AssignTripResult> {
  const { day, id, kind, vehicleId, driverId, confirmation, actor } = input;
  const runs = await readPendingRuns(tx, day);
  const run = runs.find(({ trip }) => trip.kind === kind && trip.id === id);
  if (!run) return { error: "El traslado ya tiene nave o cambió de fecha o de recorrida. Actualizá el listado." };

  const windows = run.flights.map(airportServiceWindow);
  const interval = {
    startsAt: new Date(Math.min(...windows.map(w => +w.startsAt))),
    endsAt: new Date(Math.max(...windows.map(w => +w.endsAt))), vehicleId, driverId
  };
  const [fleet, school, drivers] = await Promise.all([
    fleetConflicts(tx, interval), schoolTripConflicts(tx, interval),
    run.flights.length > 1 ? driverConflicts(tx, interval) : []
  ]);
  try {
    const result = await saveAirportFleet(tx, actor, {
      flightId: run.flights[0].id, privateReservationId: kind === "private" ? id : undefined,
      vehicleId, driverId, confirmation, pendingFlights: run.flights, additionalConflicts: [...fleet, ...school, ...drivers]
    });
    return "day" in result ? { saved: true } : result;
  } catch (error) {
    if (error instanceof BookingError) return { error: error.message };
    throw error;
  }
}
