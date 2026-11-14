import type { FleetConflict } from "@/lib/special-trips/conflicts";

/**
 * Issue #81: la nave de cada salida se elige en el formulario pero no se veía en ningún listado, así
 * que el despachante no podía armar la semana sin abrir salida por salida. Estas funciones son la
 * única fuente de la etiqueta de nave del calendario: nombre de la unidad y, cuando la ficha los
 * tiene cargados, el interno (el número que usa el cliente en su planilla) y la patente.
 */
export type VehicleIdentity = {
  id?: string;
  name: string;
  licensePlate?: string | null;
  internalNumber?: string | null;
};

/** "Interno 1910 · AE 123 AR" — vacío si la ficha no tiene esos datos. */
export function vehicleDetails(vehicle: VehicleIdentity): string {
  return [vehicle.internalNumber ? `Interno ${vehicle.internalNumber}` : null, vehicle.licensePlate]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

export function vehicleLabel(vehicle: VehicleIdentity): string {
  const details = vehicleDetails(vehicle);
  return details ? `${vehicle.name} · ${details}` : vehicle.name;
}

/**
 * Aviso de la reasignación rápida: la nave elegida ya está comprometida en ese horario. Se listan los
 * choques sin repetir y se aclara que no se guardó, para que nadie crea que el cambio pasó.
 */
export function vehicleConflictNotice(conflicts: Array<Pick<FleetConflict, "label">>): string {
  const labels = [...new Set(conflicts.map((conflict) => conflict.label))];
  return `No se cambió la nave: ya está tomada en ese horario (${labels.join("; ")}). Horarios superpuestos no se pisan desde el calendario.`;
}
