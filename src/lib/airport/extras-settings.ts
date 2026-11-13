import { z } from "zod";
import { getSetting, setSetting } from "@/lib/settings/app-settings";
import { defaultAirportExtras, type AirportExtras } from "./extras";

const key = "airport.extras";
const cents = z.number().int().min(0).max(2_147_483_647);

export const airportExtrasSchema = z.object({
  zoneExtraCents: cents,
  sportsLuggageCents: cents,
  arrivalCutoffMinutes: z.number().int().min(0).max(180),
  departureCutoffMinutes: z.number().int().min(0).max(180)
});

export async function getAirportExtras(db?: Parameters<typeof getSetting>[1]): Promise<AirportExtras> {
  const saved = await getSetting(key, db);
  if (!saved) return defaultAirportExtras;
  return airportExtrasSchema.parse({ ...defaultAirportExtras, ...JSON.parse(saved) });
}

export async function saveAirportExtras(extras: AirportExtras, userId: string) {
  await setSetting(key, JSON.stringify(airportExtrasSchema.parse(extras)), userId);
}
