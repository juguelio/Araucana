import { cache } from "react";
import { destinosDesde, origenes } from "@/app/admin/reservas/nueva/viaje-utils";
import { localizePath, type Locale } from "@/i18n/config";
import { mismoLugar } from "./place-names";
import { listPublicAirportRoutes, listPublicRoutes, listSchedulesForRoute } from "./repository";
import { expandTripCatalog } from "./public-trip-options";

// Keep the schedule payload small: each service carries its route and fares only once.
export const getTripCatalog = cache(async () => {
  const [routes, airports] = await Promise.all([listPublicRoutes(), listPublicAirportRoutes()]);
  const services = await Promise.all(routes.map(async route => ({
    route, departures: (await listSchedulesForRoute(route.id)).filter(s => s.availableSeats > 0)
      .map(({ id, departureAt, availableSeats, status }) => ({ id, departureAt, availableSeats, status }))
  })));
  return { services, airports: airports.map(({slug, specialType}) => ({slug, specialType})) };
});

export type TripCatalog = Awaited<ReturnType<typeof getTripCatalog>>;

export function airportPlaces(catalog: TripCatalog, locale: Locale) {
  const { salidas, rutas } = expandTripCatalog(catalog.services);
  const origins = origenes(salidas, rutas);
  const sma = origins.find(p => mismoLugar(p.nombre, "San Martín de los Andes"))?.nombre ?? "San Martín de los Andes";
  const link = (from: string, to = "") => localizePath("/rutas?" + new URLSearchParams(to ? {from, to} : {from}) + "#buscador", locale);
  const detail = (n: number) => n ? `${n} ${n === 1 ? "salida" : "salidas"} con lugar` : "Sin salidas cargadas";
  return {
    desde: origins.filter(p => p.nombre !== sma).map(p => ({ nombre: p.nombre, scroll: true, detalle: detail(p.salidas), href: link(p.nombre) })),
    hacia: destinosDesde(salidas, sma, rutas).map(p => ({ nombre: p.nombre, scroll: true, detalle: detail(p.salidas), href: link(sma, p.nombre) }))
  };
}
