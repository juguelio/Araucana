import { claveDeLugar, mismoLugar } from "./place-names";
import { getStopFares } from "./stop-fares";

type CorridorRoute = { from: string; to: string; bookingMode?: string; currency?: string };
type FareRoute = CorridorRoute & { priceCents: number; stops?: unknown };

// Tarifario del 18/07/2026, en pesos. Cada fila empieza en la siguiente parada.
// Las tablas son simétricas. El precio de cabecera a cabecera se administra en la ruta.
const traful = "Villa Traful";
const corridors = [
  {
    stops: ["Villa La Angostura", "Lago Espejo", "Espejo Chico - Ruca Malén", "El Portezuelo", "Puerto Arrayanes", traful],
    pesos: [
      [3300, 7000, 9800, 13800, 19000],
      [4800, 7600, 11600, 17000],
      [3800, 7900, 13200],
      [5100, 10000],
      [6000]
    ]
  },
  {
    stops: ["San Martín de los Andes", "Acceso Chapelco", "Río Hermoso", "Acceso Lago Hermoso", "Falkner", "Acceso Pichi Traful", "El Portezuelo", "Puerto Arrayanes", traful],
    pesos: [
      [5400, 9000, 12200, 14000, 16000, 21200, 25300, 30000],
      [4800, 7900, 9700, 11600, 16900, 20900, 25900],
      [4200, 6000, 7900, 13200, 17200, 22200],
      [2900, 4800, 10000, 14000, 19000],
      [2900, 8200, 12200, 15400],
      [6300, 10400, 15400],
      [5100, 10000],
      [6000]
    ]
  }
];

// Nombres del itinerario histórico que corresponden a una columna del tarifario.
const stopAliases: Record<string, string> = {
  "cerro chapelco": "Acceso Chapelco",
  "pte. rio hermoso": "Río Hermoso",
  "ruca malen": "Espejo Chico - Ruca Malén",
  "emp. ruta prov. 65": "El Portezuelo",
  "puerto arrayan": "Puerto Arrayanes"
};

export function fareStopName(name: string) {
  return stopAliases[claveDeLugar(name)] ?? name;
}

function corridorOf(route: CorridorRoute) {
  if (route.bookingMode !== "SEATED" || (route.currency && route.currency !== "ARS")) return undefined;
  return corridors.find(({ stops }) =>
    (mismoLugar(route.from, stops[0]) && mismoLugar(route.to, traful)) ||
    (mismoLugar(route.to, stops[0]) && mismoLugar(route.from, traful))
  );
}

/** Paradas del tarifario en el sentido de la salida, con las cabeceras tal como están en la ruta. */
export function corridorStops(route: CorridorRoute): string[] {
  const corridor = corridorOf(route);
  if (!corridor) return [];
  const intermediate = corridor.stops.slice(1, -1);
  return [route.from, ...(mismoLugar(route.from, traful) ? intermediate.reverse() : intermediate), route.to];
}

export function segmentPrice(route: FareRoute, boarding?: string | null, dropoff?: string | null): number | undefined {
  if (!boarding && !dropoff) return route.priceCents;
  if (route.bookingMode && route.bookingMode !== "SEATED") return undefined;
  const corridor = corridorOf(route);
  if (corridor) {
    const stops = corridorStops(route);
    const start = boarding ? stops.indexOf(fareStopName(boarding)) : 0;
    const end = dropoff ? stops.indexOf(fareStopName(dropoff)) : stops.length - 1;
    if (start >= 0 && end > start && (!boarding || start > 0) && (!dropoff || end < stops.length - 1)) {
      if (!boarding && dropoff) {
        const configured = getStopFares(route).find((stop) => fareStopName(stop.name) === fareStopName(dropoff));
        if (configured) return configured.priceCents;
      }
      const reverse = mismoLugar(route.from, traful);
      const low = reverse ? stops.length - 1 - end : start;
      return corridor.pesos[low][end - start - 1] * 100;
    }
  }
  // Las paradas con tarifa cargadas previamente siguen siendo válidas desde cabecera.
  return boarding ? undefined : getStopFares(route).find((fare) => fare.name === dropoff)?.priceCents;
}

export function destinationsFrom(route: FareRoute, boarding: string): { name: string; priceCents: number }[] {
  const stops = corridorStops(route);
  const destinations = stops.length ? stops.slice(boarding ? stops.indexOf(fareStopName(boarding)) + 1 : 1) : [];
  if (!boarding) destinations.push(...getStopFares(route).map((stop) => stops.length ? fareStopName(stop.name) : stop.name), route.to);
  return [...new Set(destinations)].flatMap((name) => {
    const priceCents = segmentPrice(route, boarding, name === route.to ? null : name);
    return priceCents === undefined ? [] : [{ name, priceCents }];
  });
}
