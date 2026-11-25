import type { ServicioApp } from "./jornada-app-types";
import { localDateKey } from "@/lib/operations/day-board";

type Ventana = Pick<ServicioApp, "id" | "fecha" | "nave" | "salida" | "fin">;

export function permiteUbicacion(ventanas: Ventana[], vehicleId: string, servicioId: unknown, manual: boolean, ahora: Date) {
  const activas = ventanas.filter(v => v.nave && v.salida && v.fin &&
    Date.parse(v.salida) <= +ahora && +ahora < Date.parse(v.fin));
  if (activas.some(v => v.nave?.id !== vehicleId)) return false;
  if (manual) {
    return activas.length === 0 && ventanas.some(v => v.id === servicioId && v.fecha === localDateKey(ahora) &&
      v.nave?.id === vehicleId && (!v.salida || !v.fin) &&
      (!v.salida || +ahora >= Date.parse(v.salida)) && (!v.fin || +ahora < Date.parse(v.fin)));
  }
  return activas.some(v => v.nave?.id === vehicleId && (servicioId == null || v.id === servicioId));
}
