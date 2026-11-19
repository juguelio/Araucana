import type { Prisma } from "@prisma/client";
import type { BoardArea, BoardRow } from "./day-board";

export type DispatchAssignment = {
  key: string; rowKey: string; area: BoardArea; title: string; href: string;
  driverId: string | null; driverName: string | null; vehicleId: string; vehicleName: string;
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

export function dispatchIssues(rows: BoardRow[], assignments: DispatchAssignment[], damages: DispatchDamage[]) {
  const issues = new Map<string, Set<string>>();
  function add(key: string, message: string) {
    const messages = issues.get(key) ?? new Set<string>();
    messages.add(message);
    issues.set(key, messages);
  }
  const severe = new Set(damages.filter(d => d.severity === "GRAVE" && d.status !== "REPARADO").map(d => d.vehicleId));
  for (const row of rows) {
    if (!row.programmed) {
      if (row.missingVehicle) add(row.key, "Falta nave");
      if (row.missingDriver) add(row.key, "Falta chofer");
      if (row.overbooked) add(row.key, "Sobrecupo de " + (row.passengers - row.capacity!) + " lugares");
      if (row.area === "AEROPUERTO" && row.status && row.passengers) add(row.key, "Vuelo " + row.status.toLowerCase());
    }
    for (const unit of row.units) {
      if (severe.has(unit.vehicleId)) add(row.key, unit.vehicleName + " tiene un daño grave");
    }
  }

  // Comparar sólo tramos del mismo recurso. Dos tramos contiguos son compatibles.
  const byResource = new Map<string, DispatchAssignment[]>();
  for (const item of assignments) {
    if (item.start === null || item.cancelled) continue;
    const keys = ["nave/" + item.vehicleId];
    if (item.driverId) keys.push("chofer/" + item.driverId);
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
        const name = resource.startsWith("nave/") ? first.vehicleName : first.driverName;
        add(first.rowKey, "Cruce de " + name + " con " + next.title);
        add(next.rowKey, "Cruce de " + name + " con " + first.title);
      }
    }
  }
  return new Map([...issues].map(([key, messages]) => [key, [...messages]]));
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
