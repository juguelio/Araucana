"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { ViajeSearchBar } from "@/app/admin/reservas/nueva/viaje-search-bar";
import { useViaje } from "@/app/admin/reservas/nueva/use-viaje";
import { destinosDesde, origenes, salidasDelTramo, viajeInicial, vueltasPosibles } from "@/app/admin/reservas/nueva/viaje-utils";
import { localizePath, type Locale } from "@/i18n/config";
import { getStopFares } from "@/lib/booking/stop-fares";
import { corridorStops } from "@/lib/booking/segment-fares";
import { mismoLugar } from "@/lib/booking/place-names";
import type { TripCatalog } from "@/lib/booking/public-trip-catalog";
import { expandTripCatalog } from "@/lib/booking/public-trip-options";
import "@/app/admin/reservas/nueva/alta-template.css";

const CheckoutForm = dynamic(() => import("@/app/reservar/[slug]/checkout-form").then(m => m.CheckoutForm));

export type TripQuery = { from?: string; to?: string; date?: string; tramos?: string; scheduleId?: string; returnScheduleId?: string };

export function PublicTripSearch({ catalog, locale, query = {}, checkoutSlug }: {
  catalog: TripCatalog; locale: Locale; query?: TripQuery; checkoutSlug?: string;
}) {
  const { salidas, rutas } = useMemo(() => expandTripCatalog(catalog.services), [catalog.services]);
  const service = catalog.services.find(s => s.route.slug === checkoutSlug);
  const places = useMemo(() => origenes(salidas, rutas), [salidas, rutas]);
  const inicio = useMemo(() => {
    const proposed = viajeInicial(salidas);
    const from = query.from || service?.route.from || proposed.origen;
    const origen = places.find(p => mismoLugar(p.nombre, from))?.nombre ?? places[0]?.nombre ?? "";
    const destinations = destinosDesde(salidas, origen, rutas);
    const to = query.to || service?.route.to || proposed.destino;
    return { origen, destino: destinations.find(p => mismoLugar(p.nombre, to))?.nombre ?? destinations[0]?.nombre ?? "" };
  }, [places, query.from, query.to, service, salidas, rutas]);
  const requested = useMemo(() => {
    const outward = salidasDelTramo(salidas, inicio.origen, inicio.destino);
    const routeDepartures = new Set(service?.departures.map(s => s.id));
    const ida = outward.find(s => (!service || routeDepartures.has(s.id)) &&
      (query.scheduleId ? s.id === query.scheduleId : Boolean(service) && (!query.date || s.dayKey === query.date)));
    const reverse = vueltasPosibles(salidas, inicio.origen, inicio.destino, ida);
    const vuelta = reverse.find(s => s.id === query.returnScheduleId);
    return { ida, vuelta, dia: outward.some(s => s.dayKey === query.date) ? query.date : undefined,
      conVuelta: query.tramos === "ida-y-vuelta" };
  }, [salidas, inicio, query.scheduleId, query.returnScheduleId, query.date, query.tramos, service]);
  const { barra, salidaIda, salidaVuelta, viajeListo } = useViaje(salidas, rutas, inicio, requested);
  const getService = (id?: string) => catalog.services.find(s => s.departures.some(d => d.id === id));
  const outbound = getService(salidaIda?.id);
  const outboundTime = outbound?.departures.find(s => s.id === salidaIda?.id)?.departureAt;
  const returnTime = getService(salidaVuelta?.id)?.departures.find(s => s.id === salidaVuelta?.id)?.departureAt;
  const params = new URLSearchParams({from: barra.origen, to: barra.destino, scheduleId: salidaIda?.id ?? ""});
  if (salidaVuelta) { params.set("tramos", "ida-y-vuelta"); params.set("returnScheduleId", salidaVuelta.id); }
  const airportHref = (direction: "ARRIVAL" | "DEPARTURE") => {
    const airport = catalog.airports.find(a => a.specialType === direction);
    return airport && localizePath(`/reservar/${airport.slug}?sentido=${direction}`, locale);
  };
  const arrival = airportHref("ARRIVAL"), departure = airportHref("DEPARTURE");
  const aeropuerto = arrival || departure ? {
    saleDe: places.find(p => mismoLugar(p.nombre, "San Martín de los Andes"))?.nombre ?? "San Martín de los Andes",
    desde: arrival ? { href: arrival, detalle: "Llegadas al aeropuerto" } : undefined,
    hacia: departure ? { href: departure, detalle: "Salidas al aeropuerto" } : undefined
  } : null;

  const route = outbound?.route ?? service?.route;
  const initialLegacyStop = service && !corridorStops(service.route).length
    ? getStopFares(service.route).find(fare => fare.name === query.to)?.name : undefined;
  const selectedSchedule = salidaIda && outbound && outboundTime ? {
    ...salidaIda, priceCents: salidaIda.priceCents ?? outbound.route.priceCents,
    currency: outbound.route.currency, departureAt: outboundTime
  } : null;
  const regreso = salidaVuelta && returnTime ? {
    ...salidaVuelta, priceCents: salidaVuelta.priceCents ?? 0, currency: salidaVuelta.currency ?? "ARS", departureAt: returnTime
  } : null;

  return (
    <div id="buscador" className="public-trip-search">
      <ViajeSearchBar {...barra} aeropuerto={aeropuerto} locale={locale} />
      {checkoutSlug && route && (
        <CheckoutForm route={route} selectedSchedule={viajeListo ? selectedSchedule : null} initialLegacyStop={initialLegacyStop}
          boardingStop={salidaIda?.boardingStop} destination={salidaIda?.dropoffStop} vuelta={regreso} />
      )}
      {!checkoutSlug && viajeListo && outbound && (
        <Link className="button" href={localizePath(`/reservar/${outbound.route.slug}?${params}`, locale)}>
          {{es: "Continuar con la reserva", en: "Continue booking", pt: "Continuar a reserva"}[locale]}
        </Link>
      )}
    </div>
  );
}
