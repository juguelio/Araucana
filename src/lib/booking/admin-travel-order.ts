import { travelDayKey } from "./admin-filters";

/**
 * Orden del listado de reservas por **día y hora del viaje** (rediseño del 20-nov: la lista se agrupa
 * por día de viaje). Prisma no puede ordenar por esa fecha porque sale de tres lugares —la salida
 * programada, el vuelo del aeropuerto o el día de Chapelco—, así que se ordena acá, con los datos
 * mínimos de cada reserva, y después se pide sólo la página.
 */
export type ClaveDeViaje = {
  id: string;
  code: string;
  createdAt: Date;
  schedule?: { departureAt: Date } | null;
  airportDetails?: { serviceDate: Date | null; flight?: { scheduledAt: Date } | null } | null;
  chapelcoDetails?: { serviceDate: Date | null } | null;
};

/** El instante con hora conocida del viaje: la salida programada o el vuelo. */
export function horaConocida(reserva: Pick<ClaveDeViaje, "schedule" | "airportDetails">): Date | null {
  return reserva.schedule?.departureAt ?? reserva.airportDetails?.flight?.scheduledAt ?? null;
}

const horaArgentina = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Salta",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

/** «10:00» en hora de Argentina, o null si el viaje no tiene hora (aeropuerto sin vuelo, Chapelco). */
export function horaDelViaje(reserva: Pick<ClaveDeViaje, "schedule" | "airportDetails">): string | null {
  const instante = horaConocida(reserva);
  return instante ? horaArgentina.format(instante) : null;
}

/**
 * Clave que ordena: el día del viaje y la hora. Lo que no tiene hora va primero dentro de su día
 * («00:00»), y lo que no tiene día (dato roto) va con el día del alta, para no perderlo.
 */
export function claveDeViaje(reserva: ClaveDeViaje): string {
  const instante = horaConocida(reserva) ?? reserva.airportDetails?.serviceDate ?? null;
  const dia = travelDayKey(reserva.chapelcoDetails?.serviceDate, instante) ?? travelDayKey(null, reserva.createdAt)!;
  const hora = horaConocida(reserva) ? horaDelViaje(reserva)! : "00:00";
  return `${dia} ${hora}`;
}

/** Ordena por viaje (desempata por código, para que una fila no salte de página entre pedidos). */
export function ordenarPorViaje<T extends ClaveDeViaje>(reservas: T[], direccion: "asc" | "desc"): T[] {
  const signo = direccion === "asc" ? 1 : -1;
  return reservas
    .map((reserva) => ({ reserva, clave: claveDeViaje(reserva) }))
    .sort((a, b) => signo * a.clave.localeCompare(b.clave) || a.reserva.code.localeCompare(b.reserva.code))
    .map(({ reserva }) => reserva);
}
