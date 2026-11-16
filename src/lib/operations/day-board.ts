/**
 * «Salidas del día» (issue #174): el cliente arma todos los días, entre las 11 y las 13, el día
 * siguiente — qué nave y qué chofer hace cada servicio. Hasta ahora eso estaba repartido en cuatro
 * pantallas (Rutas → Salidas, Aeropuerto, Chapelco, Viajes especiales) y las salidas de ruta ni
 * siquiera tenían chofer. Esto junta los servicios de un día en una sola lista, ordenada por la hora
 * en que sale la unidad, y marca lo que falta asignar.
 *
 * Todo acá es puro: recibe lo que ya se leyó de la base y devuelve las filas. Así se testea.
 */

export type BoardArea = "RUTA" | "AEROPUERTO" | "CHAPELCO" | "ESPECIAL";

export type BoardPerson = { id: string; name: string | null; email: string };

export type BoardUnit = {
  /** Id de lo que se asigna: la salida, la asignación del vuelo, la nave del día de Chapelco o la del viaje. */
  id: string;
  vehicleId: string;
  vehicleName: string;
  seats: number;
  driverId: string | null;
  driverName: string | null;
};

export type BoardRow = {
  key: string;
  area: BoardArea;
  /** El servicio al que pertenece la fila (salida, vuelo, día de Chapelco o viaje). */
  serviceId: string;
  /** Hora en que sale la unidad; `null` si el servicio no tiene una cargada. */
  at: Date | null;
  atLabel: string;
  title: string;
  detail: string | null;
  passengers: number;
  capacity: number | null;
  units: BoardUnit[];
  missingVehicle: boolean;
  missingDriver: boolean;
  overbooked: boolean;
  /** Cerrada, cancelada, demorada: lo que conviene ver antes de asignar. */
  status: string | null;
  href: string;
};

export type BoardSummary = {
  services: number;
  passengers: number;
  missingVehicle: number;
  missingDriver: number;
  overbooked: number;
};

export type ScheduleInput = {
  id: string;
  routeId: string;
  from: string;
  to: string;
  departureAt: Date;
  status: string;
  passengers: number;
  vehicle: { id: string; name: string; seats: number };
  driver: BoardPerson | null;
};

export type FlightInput = {
  id: string;
  number: string;
  direction: string;
  scheduledAt: Date;
  estimatedAt: Date | null;
  /** Inicio de recorrida (coordinado o estimado) para las partidas; lo calcula `airportPickupStart`. */
  pickupStart: Date | null;
  status: string;
  passengers: number;
  units: Array<{ id: string; vehicle: { id: string; name: string; seats: number }; driver: BoardPerson | null }>;
};

export type ChapelcoInput = {
  operationDayId: string | null;
  routeId: string;
  dateKey: string;
  status: string;
  passengers: number;
  /** Primer ascenso del día que tiene reservas ("08:30"), si hay. */
  firstAscent: Date | null;
  units: Array<{ id: string; capacity: number; vehicle: { id: string; name: string }; driver: BoardPerson | null }>;
};

export type SpecialTripInput = {
  id: string;
  client: string;
  passengers: number | null;
  status: string;
  firstLegAt: Date | null;
  units: Array<{ id: string; startsAt: Date; vehicle: { id: string; name: string; seats: number }; driver: BoardPerson | null }>;
};

export function personName(person: BoardPerson | null): string | null {
  return person ? person.name?.trim() || person.email : null;
}

const SCHEDULE_STATUS: Record<string, string> = { CLOSED: "Cerrada", DOCUMENTATION: "Documentación" };
const FLIGHT_STATUS: Record<string, string> = { DELAYED: "Demorado", CANCELLED: "Cancelado", DIVERTED: "Desviado" };

function crewFlags(passengers: number, units: BoardUnit[], needsVehicle: boolean) {
  const capacity = units.reduce((sum, unit) => sum + unit.seats, 0);
  return {
    capacity: units.length ? capacity : null,
    missingVehicle: needsVehicle && units.length === 0,
    missingDriver: units.some((unit) => !unit.driverId),
    overbooked: units.length > 0 && capacity > 0 && passengers > capacity
  };
}

export function scheduleRow(schedule: ScheduleInput): BoardRow {
  const units: BoardUnit[] = [{
    id: schedule.id,
    vehicleId: schedule.vehicle.id,
    vehicleName: schedule.vehicle.name,
    seats: schedule.vehicle.seats,
    driverId: schedule.driver?.id ?? null,
    driverName: personName(schedule.driver)
  }];
  return {
    key: `ruta-${schedule.id}`,
    area: "RUTA",
    serviceId: schedule.id,
    at: schedule.departureAt,
    atLabel: "Sale",
    title: `${schedule.from} → ${schedule.to}`,
    detail: null,
    passengers: schedule.passengers,
    ...crewFlags(schedule.passengers, units, false),
    units,
    status: SCHEDULE_STATUS[schedule.status] ?? null,
    href: `/admin/rutas/${schedule.routeId}/salidas/${schedule.id}`
  };
}

export function flightRow(flight: FlightInput, dateKey: string): BoardRow {
  const departure = flight.direction === "DEPARTURE";
  const units: BoardUnit[] = flight.units.map((unit) => ({
    id: unit.id,
    vehicleId: unit.vehicle.id,
    vehicleName: unit.vehicle.name,
    seats: unit.vehicle.seats,
    driverId: unit.driver?.id ?? null,
    driverName: personName(unit.driver)
  }));
  const flightTime = flight.estimatedAt ?? flight.scheduledAt;
  return {
    key: `vuelo-${flight.id}`,
    area: "AEROPUERTO",
    serviceId: flight.id,
    // Para una partida la combi sale cuando empieza la recorrida, no cuando despega el avión.
    at: departure ? flight.pickupStart ?? flight.scheduledAt : flightTime,
    atLabel: departure ? (flight.pickupStart ? "Recorrida" : "Despega") : "Aterriza",
    title: `${flight.number} · ${departure ? "partida" : "llegada"}`,
    detail: departure ? "Hoteles → Aeropuerto Chapelco" : "Aeropuerto Chapelco → hoteles",
    passengers: flight.passengers,
    ...crewFlags(flight.passengers, units, flight.passengers > 0 && flight.status !== "CANCELLED"),
    units,
    status: FLIGHT_STATUS[flight.status] ?? null,
    href: `/admin/aeropuerto?date=${dateKey}#vuelo-${flight.id}`
  };
}

export function chapelcoRow(day: ChapelcoInput): BoardRow {
  const units: BoardUnit[] = day.units.map((unit) => ({
    id: unit.id,
    vehicleId: unit.vehicle.id,
    vehicleName: unit.vehicle.name,
    seats: unit.capacity,
    driverId: unit.driver?.id ?? null,
    driverName: personName(unit.driver)
  }));
  return {
    key: `chapelco-${day.dateKey}`,
    area: "CHAPELCO",
    // Para sumar una nave a Chapelco hace falta la ruta (el día de operación se crea al asignar).
    serviceId: day.routeId,
    at: day.firstAscent,
    atLabel: day.firstAscent ? "Primer ascenso" : "Todo el día",
    title: "Chapelco · traslado al cerro",
    detail: null,
    passengers: day.passengers,
    ...crewFlags(day.passengers, units, day.passengers > 0 && day.status !== "CANCELLED"),
    units,
    status: day.status === "CANCELLED" ? "Cancelada" : null,
    href: `/admin/chapelco?date=${day.dateKey}`
  };
}

export function specialTripRow(trip: SpecialTripInput): BoardRow {
  const units: BoardUnit[] = trip.units.map((unit) => ({
    id: unit.id,
    vehicleId: unit.vehicle.id,
    vehicleName: unit.vehicle.name,
    seats: unit.vehicle.seats,
    driverId: unit.driver?.id ?? null,
    driverName: personName(unit.driver)
  }));
  const firstUnit = trip.units.reduce<Date | null>((min, unit) => (!min || unit.startsAt < min ? unit.startsAt : min), null);
  const passengers = trip.passengers ?? 0;
  return {
    key: `especial-${trip.id}`,
    area: "ESPECIAL",
    serviceId: trip.id,
    at: firstUnit ?? trip.firstLegAt,
    atLabel: "Sale",
    title: trip.client,
    detail: "Viaje especial",
    passengers,
    ...crewFlags(passengers, units, true),
    units,
    status: null,
    href: `/admin/viajes-especiales/${trip.id}`
  };
}

/** Ordena por la hora en que sale la unidad; lo que no tiene hora va al final. */
export function sortBoard(rows: BoardRow[]): BoardRow[] {
  return [...rows].sort((a, b) => {
    if (a.at && b.at) return a.at.getTime() - b.at.getTime() || a.title.localeCompare(b.title, "es");
    if (a.at) return -1;
    if (b.at) return 1;
    return a.title.localeCompare(b.title, "es");
  });
}

export function buildDayBoard(input: {
  dateKey: string;
  schedules: ScheduleInput[];
  flights: FlightInput[];
  chapelco: ChapelcoInput[];
  specialTrips: SpecialTripInput[];
}): { rows: BoardRow[]; summary: BoardSummary } {
  const rows = sortBoard([
    ...input.schedules.filter((schedule) => !["CANCELLED", "CANCELED"].includes(schedule.status)).map(scheduleRow),
    // Un vuelo sin pasajeros ni combis no es un servicio todavía: en el tablero sólo sería ruido.
    ...input.flights.filter((flight) => flight.passengers > 0 || flight.units.length > 0).map((flight) => flightRow(flight, input.dateKey)),
    ...input.chapelco.filter((day) => day.passengers > 0 || day.units.length > 0).map(chapelcoRow),
    ...input.specialTrips.filter((trip) => trip.status !== "CANCELLED").map(specialTripRow)
  ]);
  const summary = rows.reduce<BoardSummary>(
    (acc, row) => ({
      services: acc.services + 1,
      passengers: acc.passengers + row.passengers,
      missingVehicle: acc.missingVehicle + (row.missingVehicle ? 1 : 0),
      missingDriver: acc.missingDriver + (row.missingDriver ? 1 : 0),
      overbooked: acc.overbooked + (row.overbooked ? 1 : 0)
    }),
    { services: 0, passengers: 0, missingVehicle: 0, missingDriver: 0, overbooked: 0 }
  );
  return { rows, summary };
}

const TZ_OFFSET_MIN = -180; // America/Argentina/Salta (-03), sin horario de verano

export function localDateKey(date: Date): string {
  return new Date(date.getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

export function dayRange(dateKey: string) {
  const from = new Date(`${dateKey}T00:00:00.000-03:00`);
  return { from, to: new Date(from.getTime() + 24 * 3600 * 1000) };
}

export function shiftDateKey(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function isDateKey(value: string | undefined | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}
