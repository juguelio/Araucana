import type { Flight, PrismaClient } from '@prisma/client';

type Snapshot = Pick<Flight, 'number' | 'airline' | 'origin' | 'destination' | 'source' | 'externalId'> & {
  scheduledAt: string;
  lastCheckedAt: string | null;
};
type ExistingFlight = Pick<
  Flight,
  | 'id'
  | 'direction'
  | 'number'
  | 'airline'
  | 'origin'
  | 'destination'
  | 'source'
  | 'status'
  | 'scheduledAt'
  | 'lastCheckedAt'
  | 'externalId'
  | 'pickupStartInitialAt'
  | 'pickupStartOverrideAt'
  | 'pickupGroupId'
  | 'actualAt'
  | 'estimatedAt'
  | 'passengers'
> & {
  _count: { reservations: number; assignments: number };
};
type Kind = 'CREATE' | 'UPDATE' | 'WITHDRAW' | 'REVIEW' | 'RESTORE';
type Plan = {
  changes: { id: string; direction: string; kind: Kind; before: Snapshot | null; after: Snapshot }[];
  warnings: { id?: string; key?: string; reason: string }[];
};
type Options = { apply?: boolean; now?: Date };
export type ScheduleImportResult = Plan & {
  runId: string | null;
  applied: boolean;
  counts: Record<Kind, number>;
};
export function planSchedules(payload: unknown, rows: ExistingFlight[], now?: Date): Plan;
export function applySchedules(
  prisma: PrismaClient,
  payload: unknown,
  options?: Options,
): Promise<ScheduleImportResult>;
export function rollbackSchedules(
  prisma: PrismaClient,
  runId: string,
  options?: Options,
): Promise<ScheduleImportResult>;
