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
    const pickup = airportPickupStart({ ...flight, status: undefined })
      ?? new Date(time.getTime() - AIRPORT_PICKUP_LEAD_MINUTES * MINUTE);
    // Una recorrida coordinada después del vuelo no tiene sentido; no se deja que la ventana quede vacía.
    return { startsAt: pickup < time ? pickup : new Date(time.getTime() - AIRPORT_PICKUP_LEAD_MINUTES * MINUTE), endsAt: time };
  }
  return {
    startsAt: new Date(time.getTime() - ARRIVAL_WAIT_MINUTES * MINUTE),
    endsAt: new Date(time.getTime() + ARRIVAL_DROP_OFF_MINUTES * MINUTE)
  };
}
