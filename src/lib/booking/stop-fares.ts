export type StopFare = { name: string; priceCents: number };

export function getStopFares(route: { from: string; to: string; priceCents: number; stops?: unknown }): StopFare[] {
  if (!Array.isArray(route.stops)) return [];

  const endpoints = new Set([route.from, route.to].map((name) => name.trim().toLowerCase()));
  const fares = new Map<string, StopFare>();
  for (const stop of route.stops) {
    if (!stop || typeof stop.name !== "string") continue;
    const name = stop.name.trim();
    const key = name.toLowerCase();
    const priceCents = stop.priceCents;
    if (!name || name.length > 160 || endpoints.has(key) || fares.has(key)) continue;
    if (!Number.isSafeInteger(priceCents) || priceCents <= 0 || priceCents >= route.priceCents) continue;
    fares.set(key, { name, priceCents });
  }

  return [...fares.values()];
}
