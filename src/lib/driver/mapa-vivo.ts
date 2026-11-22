import type { NaveEnVivo } from "./en-vivo";

export const PALETA_RECORRIDO = ["#17664f", "#2868a2", "#a04d25", "#78429e", "#866700", "#226d75", "#96375d", "#506b26"];

/**
 * Un color por chofer, asignado por orden alfabético del conjunto y sin repetir mientras alcance la
 * paleta. Con hash, dos choferes caían en el mismo tono y sus líneas se confundían (pasó con dos
 * unidades en la misma pantalla). Con orden estable, sumar o quitar un chofer no repinta a los demás
 * salvo que cambie el orden.
 */
export function asignarColores(driverIds: string[]): Map<string, string> {
  const unicos = [...new Set(driverIds)].sort((a, b) => a.localeCompare(b, "es"));
  return new Map(unicos.map((id, i) => [id, PALETA_RECORRIDO[i % PALETA_RECORRIDO.length]]));
}

export function posicionValida(nave: NaveEnVivo) {
  return Number.isFinite(nave.latitude) && Math.abs(nave.latitude) <= 90 &&
    Number.isFinite(nave.longitude) && Math.abs(nave.longitude) <= 180 &&
    Number.isFinite(Date.parse(nave.recordedAt));
}

/** Una fila por chofer en la DB no equivale a una unidad: prevalece su reporte más reciente. */
export function unidadesActuales(naves: NaveEnVivo[], ahora: number, ventana: number) {
  const unidades = new Map<string, NaveEnVivo>();
  for (const nave of naves) {
    if (!posicionValida(nave)) continue;
    const anterior = unidades.get(nave.vehicleId);
    if (anterior && Date.parse(anterior.recordedAt) >= Date.parse(nave.recordedAt)) continue;
    const minutos = Math.max(0, Math.floor((ahora - Date.parse(nave.recordedAt)) / 60_000));
    unidades.set(nave.vehicleId, { ...nave, minutosDesdeLaSenal: minutos,
      estado: minutos > ventana ? "sin-senal" : nave.isStopped ? "detenida" : "en-movimiento" });
  }
  return [...unidades.values()].sort((a, b) =>
    (a.internalNumber ?? a.vehicleName).localeCompare(b.internalNumber ?? b.vehicleName, "es"));
}

/** Sólo transición visual breve entre dos reportes reales; nunca extrapolación. */
export function puedeAnimar(anterior: NaveEnVivo, nueva: NaveEnVivo, reducirMovimiento: boolean) {
  const delta = Date.parse(nueva.recordedAt) - Date.parse(anterior.recordedAt);
  const metros = Math.hypot((nueva.latitude - anterior.latitude) * 111_320,
    (nueva.longitude - anterior.longitude) * 111_320 * Math.cos(anterior.latitude * Math.PI / 180));
  return !reducirMovimiento && anterior.driverId === nueva.driverId && anterior.vehicleId === nueva.vehicleId &&
    anterior.estado !== "sin-senal" && nueva.estado === "en-movimiento" &&
    delta > 0 && delta <= 120_000 && metros >= 3 && metros <= 3_000 && metros / (delta / 1000) <= 50;
}

export function nombreUnidad(nave: NaveEnVivo) {
  return nave.internalNumber ? `Interno ${nave.internalNumber}` : nave.vehicleName;
}
export function distanciaVisible(metros: number) {
  return metros >= 1000 ? `${(metros / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(metros)} m`;
}
export function horaSenal(iso: string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}
