import type { Prisma } from "@prisma/client";
import { AIRPORT_PICKUP_LEAD_MINUTES } from "./pickup-start";
import { ARRIVAL_DROP_OFF_MINUTES, ARRIVAL_WAIT_MINUTES } from "./service-window";

const timeFields = ["scheduledAt", "estimatedAt", "pickupStartInitialAt", "pickupStartOverrideAt"] as const;

/**
 * Preselección para airportServiceWindow: un arribo puede seguir repartiendo al otro día y una
 * partida puede empezar con una recogida coordinada la noche anterior. Una demora también puede
 * abarcar todo el intervalo sin que ninguno de sus horarios caiga dentro de él.
 */
export function airportWindowCandidates(startsAt: Date, endsAt: Date): Prisma.FlightWhereInput {
  const earliest = new Date(+startsAt - Math.max(ARRIVAL_DROP_OFF_MINUTES, AIRPORT_PICKUP_LEAD_MINUTES) * 60_000);
  const latest = new Date(+endsAt + Math.max(ARRIVAL_WAIT_MINUTES, AIRPORT_PICKUP_LEAD_MINUTES) * 60_000);
  return {
    status: { notIn: ["CANCELLED", "DIVERTED"] },
    AND: [
      { OR: timeFields.map(field => ({ [field]: { gt: earliest } })) },
      { OR: timeFields.map(field => ({ [field]: { lt: latest } })) }
    ]
  };
}
