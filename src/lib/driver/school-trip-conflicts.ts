import type { Prisma } from "@prisma/client";
import { dayRange, localDateKey } from "@/lib/operations/day-board";
import { leerTurno, solapeDeTurnos } from "@/lib/school-runs/dia";
import type { FleetConflict } from "@/lib/special-trips/conflicts";

type Window = { startsAt: Date; endsAt: Date };
type CrewWindow = Window & { driverId: string; vehicleId: string };

/** Un horario puntual ocupa ese minuto. Un turno con nombre sólo indica una franja posible. */
export function schoolTripWindow(day: string, shift: string): Window | null {
  const { minutos, cubre } = leerTurno(shift);
  const range = minutos === null ? cubre : [minutos, minutos + 1];
  if (!range) return null;
  const midnight = +dayRange(day).from;
  return { startsAt: new Date(midnight + range[0] * 60_000), endsAt: new Date(midnight + range[1] * 60_000) };
}

/** Comprueba también las concesiones que comparten nave o chofer con la asignación propuesta. */
export async function schoolTripConflicts(
  tx: Prisma.TransactionClient, crew: CrewWindow, school?: { id: string; shift: string }
): Promise<FleetConflict[]> {
  const first = localDateKey(crew.startsAt);
  const last = localDateKey(new Date(+crew.endsAt - 1));
  const runs = await tx.schoolRun.findMany({
    where: {
      serviceDate: { gte: new Date(first + "T00:00:00Z"), lte: new Date(last + "T00:00:00Z") },
      OR: [{ vehicleId: crew.vehicleId }, { driverId: crew.driverId }],
      ...(school ? { id: { not: school.id } } : {})
    },
    select: { id: true, serviceDate: true, routeName: true, shift: true, driverId: true, vehicleId: true }
  });
  const conflicts: FleetConflict[] = [];
  for (const run of runs) {
    const shift = leerTurno(run.shift);
    let possible: boolean;
    if (school) {
      const overlap = solapeDeTurnos(leerTurno(school.shift), shift);
      if (!overlap) continue;
      possible = overlap === "posible";
    } else {
      const window = schoolTripWindow(run.serviceDate.toISOString().slice(0, 10), run.shift);
      if (!window || window.startsAt >= crew.endsAt || window.endsAt <= crew.startsAt) continue;
      possible = shift.minutos === null;
    }
    const label = `Concesiones · ${run.routeName} · ${shift.etiqueta}`;
    const base = { href: `/admin/escolares/${run.id}`, possible };
    if (run.vehicleId === crew.vehicleId) conflicts.push({ ...base, id: `concesion:${run.id}`, label });
    if (run.driverId === crew.driverId) conflicts.push({ ...base, id: `chofer:concesion:${run.id}`, label: `Chofer · ${label}`, subject: "driver" });
  }
  return conflicts;
}
