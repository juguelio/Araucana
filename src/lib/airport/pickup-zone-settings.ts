import { z } from "zod";
import { getSetting, setSetting } from "@/lib/settings/app-settings";
import { initialAirportCoverage, type AirportCoverage } from "./pickup-zone";

const key = "airport.pickupCoverage";
const point = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);
const polygon = z.array(point).min(3).max(250).refine((ring) => {
  const [latOrigin, lngOrigin] = ring[0] ?? [0, 0];
  const area = ring.reduce((sum, [lat, lng], index) => {
    const [nextLat, nextLng] = ring[(index + 1) % ring.length];
    return sum + (lat - latOrigin) * (nextLng - lngOrigin) - (nextLat - latOrigin) * (lng - lngOrigin);
  }, 0);
  return Math.abs(area) > 1e-12;
});

export const airportCoverageSchema = z.object({
  enabled: z.boolean(),
  boundary: polygon,
  exclusions: z.array(polygon).max(25),
  /** Segundo límite (zona con recargo). Vacío = sin zona con recargo. */
  extraBoundary: z.union([z.array(point).length(0), polygon]).optional()
});

export async function getAirportCoverage(db?: Parameters<typeof getSetting>[1]): Promise<AirportCoverage> {
  const saved = await getSetting(key, db);
  return saved ? airportCoverageSchema.parse(JSON.parse(saved)) : initialAirportCoverage;
}

export async function saveAirportCoverage(coverage: AirportCoverage, userId: string) {
  await setSetting(key, JSON.stringify(coverage), userId);
}
