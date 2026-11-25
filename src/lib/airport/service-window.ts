import { horaEfectivaDelVuelo } from "./effective-time";
import { AIRPORT_PICKUP_LEAD_MINUTES, airportPickupStart } from "./pickup-start";

const MINUTE = 60_000;

/** Cuánto antes del aterrizaje el chofer ya está esperando en el aeropuerto. */
export const ARRIVAL_WAIT_MINUTES = 30;
/** Cuánto tarda en repartir a los pasajeros de un arribo por sus domicilios. */
export const ARRIVAL_DROP_OFF_MINUTES = 120;

type FlightTimes = {
  direction: string;
  scheduledAt: Date;
  estimatedAt?: Date | null;
  pickupStartInitialAt?: Date | null;
  pickupStartOverrideAt?: Date | null;
  status?: string;
};

/**
 * El tramo en que la combi (y su chofer) están ocupados con un vuelo, para avisar cruces con otras
 * salidas. Una partida va del inicio de la recorrida (coordinado o estimado) hasta la hora efectiva
 * del vuelo; un arribo, desde un rato antes del aterrizaje hasta terminar el reparto.
 */
export function airportServiceWindow(flight: FlightTimes): { startsAt: Date; endsAt: Date } {
  const time = horaEfectivaDelVuelo(flight);
  if (flight.direction === "DEPARTURE") {
    const pickup = airportPickupStart({ ...flight, status: undefined })!;
    // Si un adelanto deja el vuelo antes de la recogida, conservar la ventana prevista de la combi.
    if (time > pickup) return { startsAt: pickup, endsAt: time };
    const plannedEnd = flight.scheduledAt > pickup ? flight.scheduledAt : new Date(+pickup + AIRPORT_PICKUP_LEAD_MINUTES * MINUTE);
    return { startsAt: pickup, endsAt: plannedEnd };
  }
  return {
    startsAt: new Date(time.getTime() - ARRIVAL_WAIT_MINUTES * MINUTE),
    endsAt: new Date(time.getTime() + ARRIVAL_DROP_OFF_MINUTES * MINUTE)
  };
}
