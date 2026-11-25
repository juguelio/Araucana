import type { AuditActor } from "@/lib/audit/record";
import type { FleetConflict } from "@/lib/special-trips/conflicts";

export const tripKinds = ["airport", "private", "schedule", "special", "school", "chapelco"] as const;
export type TripKind = (typeof tripKinds)[number];

export type PendingTrip = {
  day: string;
  kind: TripKind;
  id: string;
  title: string;
  detail: string;
  /** Hora o inicio del turno para ordenar los recorridos del día. */
  startsAt: number;
  service: string;
};

export type AssignTripInput = {
  kind: TripKind;
  id: string;
  day: string;
  driverId: string;
  vehicleId: string;
  actor: AuditActor & { id: string };
  confirmation: string;
};

export type AssignTripResult =
  | { saved: true }
  | { error: string }
  | { conflicts: FleetConflict[]; confirmation: string };
