export type PickupPoint = [latitude: number, longitude: number];
export type AirportCoverage = { enabled: boolean; boundary: PickupPoint[]; exclusions: PickupPoint[][] };

// Exportado de Google My Maps «mapa aeropuerto», capa «zona ok».
export const airportPickupZone: PickupPoint[] = [
  [-40.0737628, -71.1472815],
  [-40.1130296, -71.1774955],
  [-40.1178871, -71.2200697],
  [-40.1239257, -71.2605839],
  [-40.1229099, -71.2782645],
  [-40.1259779, -71.2942297],
  [-40.1315389, -71.3053898],
  [-40.1349184, -71.3228997],
  [-40.143121, -71.3234151],
  [-40.1454503, -71.3368054],
  [-40.1491245, -71.3553458],
  [-40.1703787, -71.391225],
  [-40.1817903, -71.3967184],
  [-40.185856, -71.363586],
  [-40.164869, -71.3345737],
  [-40.1592276, -71.3165484],
  [-40.1552915, -71.3028147],
  [-40.1471898, -71.2980917],
  [-40.1383591, -71.2844819],
  [-40.1331139, -71.2576225],
  [-40.1436131, -71.2370651],
  [-40.1346888, -71.1663369],
  [-40.0884741, -71.1191276]
];

export const airportPickupLimits: PickupPoint[][] = [
  [
    [-40.1315803, -71.323353],
    [-40.131285, -71.3226234],
    [-40.1308256, -71.3204562]
  ],
  [
    [-40.1443264, -71.3359272],
    [-40.1459994, -71.3362705],
    [-40.1453762, -71.3360988]
  ]
];

export const OUTSIDE_PICKUP_ZONE = "El punto marcado queda fuera de la zona de servicio. Consultanos antes de reservar.";
export const MAX_PICKUP_ADJUSTMENT_METERS = 100;

export function pickupAdjustmentMeters(origin: PickupPoint, point: PickupPoint) {
  const metersPerDegree = 111_320;
  const latitude = (origin[0] + point[0]) / 2 * Math.PI / 180;
  return metersPerDegree * Math.hypot(point[0] - origin[0], (point[1] - origin[1]) * Math.cos(latitude));
}

export const initialAirportCoverage: AirportCoverage = { enabled: false, boundary: airportPickupZone, exclusions: [] };

export function isInsideAirportPickupZone(point: PickupPoint, coverage: AirportCoverage) {
  return pointInPolygon(point, coverage.boundary) && !coverage.exclusions.some((ring) => pointInPolygon(point, ring));
}

function pointInPolygon([latitude, longitude]: PickupPoint, ring: PickupPoint[]) {
  if (ring.length < 3) return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const [latA, lngA] = ring[i];
    const [latB, lngB] = ring[(i + 1) % ring.length];
    // La línea del perímetro pertenece a la zona.
    const cross = (longitude - lngA) * (latB - latA) - (latitude - latA) * (lngB - lngA);
    if (Math.abs(cross) < 1e-12 &&
        latitude >= Math.min(latA, latB) && latitude <= Math.max(latA, latB) &&
        longitude >= Math.min(lngA, lngB) && longitude <= Math.max(lngA, lngB)) return true;
    if ((latA > latitude) !== (latB > latitude) &&
        longitude < lngA + ((lngB - lngA) * (latitude - latA)) / (latB - latA)) inside = !inside;
  }
  return inside;
}
