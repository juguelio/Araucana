import { AirportSearch } from "@/app/reservar/[slug]/airport-search";
import { PublicTripSearch, type TripQuery } from "./public-trip-search";
import { airportPlaces, type TripCatalog } from "@/lib/booking/public-trip-catalog";
import { getAirportFares } from "@/lib/airport/fares";
import { diaKey } from "@/lib/booking/schedule-days";
import { localizePath, type Locale } from "@/i18n/config";

export async function PublicBookingSearch({catalog, locale, query}: {catalog: TripCatalog; locale: Locale; query?: TripQuery}) {
  const airport = catalog.airports.find(a => a.specialType === "DEPARTURE") ?? catalog.airports[0];
  if (!airport || query?.from || query?.to || query?.date || query?.tramos) {
    return <PublicTripSearch key={JSON.stringify(query)} catalog={catalog} locale={locale} query={query} />;
  }
  const date = diaKey(new Date());
  const fares = await getAirportFares();
  const fare = fares.DEPARTURE ?? fares.ARRIVAL;
  if (!fare) return <PublicTripSearch catalog={catalog} locale={locale} />;
  const path = localizePath(`/reservar/${fare.slug}`, locale);
  return <AirportSearch locale={locale} slug={fare.slug} fares={fares}
    initialDate={date} initialDirection="DEPARTURE" lugaresExtra={airportPlaces(catalog, locale)}
    checkoutHref={path} roundTripHref={path + "/ida-y-vuelta"} continueLabel={{es: "Continuar con la reserva", en: "Continue booking", pt: "Continuar a reserva"}[locale]} />;
}
