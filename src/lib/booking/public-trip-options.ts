import { unificarLugares } from "@/app/admin/reservas/nueva/viaje-utils";
import type { TripCatalog } from "./public-trip-catalog";
import { etiquetasDeSalida } from "./schedule-days";
import { getStopFares } from "./stop-fares";

export function expandTripCatalog(services: TripCatalog["services"]) {
  const routes = services.map(service => service.route);
  const schedules = services.flatMap(({ route, departures }) => {
    const { from, to, bookingMode, currency, priceCents } = route;
    const stopFares = getStopFares(route);
    return departures.map(s => ({
      ...s, ...etiquetasDeSalida(s.departureAt), from, to, bookingMode, currency, priceCents, stopFares
    }));
  });
  return unificarLugares(schedules, routes);
}
