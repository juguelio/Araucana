import type { Prisma } from "@prisma/client";
import { estadoDeTaller } from "../vehicles/estado-en-flota";
import type { BoardArea, BoardRow } from "./day-board";

export type DispatchAssignment = {
  key: string; rowKey: string; area: BoardArea; title: string; href: string;
  driverId: string | null; driverName: string | null; vehicleId: string | null; vehicleName: string;
  coDriverId?: string | null; coDriverName?: string | null;
  orderDate?: string; programmed?: boolean; shift?: string; detail?: string;
  start: number | null; end: number | null; sharedPickupId?: string | null; estimatedWindow?: boolean; cancelled?: boolean;
};
export type DispatchDamage = { id: string; vehicleId: string; description: string; severity: string; status: string };

/** Los horarios sin fin conocido se comparan como instantes. Dos turnos contiguos son compatibles. */
export function assignmentsOverlap(a: DispatchAssignment, b: DispatchAssignment) {
  if (a.cancelled || b.cancelled || a.start === null || b.start === null) return false;
  if (a.sharedPickupId && a.sharedPickupId === b.sharedPickupId && a.vehicleId === b.vehicleId) return false;
  if (a.start === b.start) return true;
  if (a.start < b.start) return a.end !== null && b.start < a.end;
  return b.end !== null && a.start < b.end;
}

export function daniosPorNave(damages: DispatchDamage[]) {
  const byVehicle = new Map<string, DispatchDamage[]>();
  for (const damage of damages) {
    const list = byVehicle.get(damage.vehicleId);
    if (list) list.push(damage);
    else byVehicle.set(damage.vehicleId, [damage]);
  }
  return byVehicle;
}

type QueueLevel = "capacidad" | "cruce" | "equipo" | "novedad";
const order: Record<QueueLevel, number> = { capacidad: 0, cruce: 1, equipo: 2, novedad: 3 };

export function dispatchReview(rows: BoardRow[], assignments: DispatchAssignment[], damages: ReadonlyMap<string, DispatchDamage[]>, now?: number) {
  const issues = new Map<string, Map<string, { level: QueueLevel; summary: string }>>();
  function add(key: string, level: QueueLevel, message: string, summary = message) {
    const messages = issues.get(key) ?? new Map();
    messages.set(message, { level, summary });
    issues.set(key, messages);
  }
  for (const row of rows) {
    if (row.inactiveRoute && row.passengers > 0) add(row.key, "capacidad", "Ruta inactiva con pasajeros");
    if (!row.programmed) {
      if (row.missingVehicle) add(row.key, "equipo", "Falta nave", row.missingDriver ? "Faltan nave y chofer" : "Falta nave");
      if (row.missingDriver) add(row.key, "equipo", "Falta chofer");
      if (row.overbooked) add(row.key, "capacidad", "Sobrecupo de " + (row.passengers - row.capacity!) + " lugares");
      if (row.area === "AEROPUERTO" && row.status && row.passengers) add(row.key, "novedad", "Vuelo " + row.status.toLowerCase());
    }
    for (const unit of row.units) {
      const taller = estadoDeTaller(damages.get(unit.vehicleId) ?? []);
      if (taller) add(row.key, "capacidad", unit.vehicleName + (taller.clave === "danio-grave" ? " tiene un daño grave" : " está en reparación"));
    }
  }

  // Comparar sólo tramos del mismo recurso. Dos tramos contiguos son compatibles.
  const byResource = new Map<string, DispatchAssignment[]>();
  for (const item of assignments) {
    if (item.start === null || item.cancelled) continue;
    const keys = item.vehicleId ? ["nave/" + item.vehicleId] : [];
    if (item.driverId) keys.push("chofer/" + item.driverId);
    if (item.coDriverId) keys.push("chofer/" + item.coDriverId);
    for (const key of keys) {
      const items = byResource.get(key) ?? [];
      items.push(item);
      byResource.set(key, items);
    }
  }
  for (const [resource, items] of byResource) {
    items.sort((a, b) => a.start! - b.start!);
    for (const [i, first] of items.entries()) {
      for (let j = i + 1; j < items.length; j++) {
        const next = items[j];
        if (next.start !== first.start && next.start! >= (first.end ?? first.start!)) break;
        if (!assignmentsOverlap(first, next)) continue;
        const name = resource.startsWith("nave/") ? first.vehicleName : resource === "chofer/" + first.coDriverId ? first.coDriverName : first.driverName;
        add(first.rowKey, "cruce", "Cruce de " + name + " con " + next.title, "Cruce de horario");
        add(next.rowKey, "cruce", "Cruce de " + name + " con " + first.title, "Cruce de horario");
      }
    }
  }
  const messages = new Map<string, string[]>();
  const summaries = new Map<string, string>();
  const levels = new Map<string, number>();
  for (const [key, details] of issues) {
    const sorted = [...details].sort((a, b) => order[a[1].level] - order[b[1].level]);
    const first = sorted[0][1];
    messages.set(key, sorted.map(([message]) => message));
    summaries.set(key, first.summary);
    levels.set(key, order[first.level]);
  }
  const finalEnd = new Map<string, number>();
  for (const job of assignments) finalEnd.set(job.rowKey, Math.max(finalEnd.get(job.rowKey) ?? 0, job.end ?? Infinity));
  const rank = (row: BoardRow) => {
    const past = now !== undefined && (finalEnd.get(row.key) ?? Infinity) <= now;
    return Number(past) * 10 + Number(row.programmed) * 5 + levels.get(row.key)!;
  };
  const pending = rows.filter(row => issues.has(row.key)).sort((a,b) =>
    rank(a) - rank(b) || (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity) || b.passengers - a.passengers);
  return { messages, summaries, pending };
}

export function dispatchIssues(rows: BoardRow[], assignments: DispatchAssignment[], damages: ReadonlyMap<string, DispatchDamage[]>) {
  return dispatchReview(rows, assignments, damages).messages;
}

export function panelServiceHref(date: string, rowKey: string) {
  return "/admin?" + new URLSearchParams({ date, servicio: rowKey }) + "#servicio-" + encodeURIComponent(rowKey);
}

/** Las salidas agrupadas a la misma hora pueden tener reservas en más de un Schedule. */
export function serviceReservationScope(row: BoardRow): Prisma.ReservationWhereInput | undefined {
  if (row.area === "RUTA") return { scheduleId: { in: [...new Set(row.units.flatMap(unit => unit.scheduleId ? [unit.scheduleId] : []))] } };
  if (row.area === "AEROPUERTO") return { airportDetails: { is: { flightId: row.serviceId } } };
  if (row.area === "CHAPELCO") return { bookingMode: "CHAPELCO", routeId: row.serviceId };
  return undefined;
}
