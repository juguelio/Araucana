import type { Prisma } from "@prisma/client";
import { statuses } from "@/lib/special-trips/data";

/**
 * Lógica pura del listado de viajes especiales: vistas rápidas, meses con viajes,
 * etiquetas de fecha y tono de cada fila. `serviceDate` es un DATE guardado a las
 * 00:00Z, así que todo se formatea en UTC; «hoy» llega ya resuelto en hora argentina.
 */

export const vistas = {
  proximos: "Próximos",
  hoy: "Hoy",
  semana: "Esta semana",
  pendientes: "Pendientes",
  sinNave: "Confirmados sin nave",
  realizados: "Realizados",
  todos: "Todos"
} as const;
export type Vista = keyof typeof vistas;
export const vistaInicial: Vista = "proximos";
const dayMs = 86_400_000;

export function vistaDe(raw: string): Vista {
  return Object.hasOwn(vistas, raw) ? raw as Vista : vistaInicial;
}

export function claveDia(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function sumarDias(date: Date, days: number) {
  return new Date(+date + days * dayMs);
}

/** Filtro y orden de cada vista. Las que miran al futuro van en orden ascendente (lo más cercano primero). */
export function condicionVista(vista: Vista, hoy: Date): { where: Prisma.SpecialTripWhereInput; orden: "asc" | "desc" } {
  switch (vista) {
    case "hoy": return { where: { serviceDate: hoy }, orden: "asc" };
    case "semana": return { where: { serviceDate: { gte: hoy, lt: sumarDias(hoy, 7) } }, orden: "asc" };
    case "pendientes": return { where: { status: "PENDING" }, orden: "asc" };
    case "sinNave": return { where: { status: "CONFIRMED", serviceDate: { gte: hoy }, assignments: { none: {} } }, orden: "asc" };
    case "realizados": return { where: { status: "COMPLETED" }, orden: "desc" };
    case "todos": return { where: {}, orden: "desc" };
    default: return { where: { serviceDate: { gte: hoy }, status: { not: "CANCELLED" } }, orden: "asc" };
  }
}

const formatoDia = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const formatoMesLargo = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", month: "long", year: "numeric" });
const formatoMes = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", month: "short", year: "numeric" });

/** «mar 10 nov» (más el año cuando no es el de hoy). */
export function etiquetaFecha(date: Date, hoy: Date) {
  const base = formatoDia.format(date).replace(",", "").replace(".", "");
  return date.getUTCFullYear() === hoy.getUTCFullYear() ? base : `${base} ${date.getUTCFullYear()}`;
}

/** «Hoy», «Mañana» o «Ayer» cuando corresponde; si no, nada. */
export function etiquetaRelativa(date: Date, hoy: Date) {
  const diff = Math.round((+date - +hoy) / dayMs);
  return diff === 0 ? "Hoy" : diff === 1 ? "Mañana" : diff === -1 ? "Ayer" : "";
}

/** Encabezado de cada grupo de mes: «noviembre de 2026». */
export function etiquetaGrupo(date: Date) {
  return formatoMesLargo.format(date);
}

export function etiquetaMes(clave: string) {
  return formatoMes.format(new Date(clave + "-01T00:00:00Z")).replace(".", "");
}

/** Meses con viajes y cuántos tiene cada uno, en orden cronológico. */
export function mesesConViajes(fechas: Date[]) {
  const conteo = new Map<string, number>();
  for (const fecha of fechas) {
    const clave = claveDia(fecha).slice(0, 7);
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  }
  return [...conteo].sort(([a], [b]) => a.localeCompare(b)).map(([clave, count]) => ({ clave, count, label: etiquetaMes(clave) }));
}

export function rangoMes(clave: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(clave)) return null;
  const inicio = new Date(clave + "-01T00:00:00Z");
  return { gte: inicio, lt: new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, 1)) };
}

export type Tono = "normal" | "curso" | "ok" | "atencion" | "grave";

/** Qué tan urgente es la fila: lo que necesita acción se marca, lo que ya pasó no. */
export function tonoFila(trip: { status: string; serviceDate: Date }, tieneNave: boolean, hoy: Date): { tono: Tono; label: string } {
  const label = statuses[trip.status as keyof typeof statuses] ?? trip.status;
  const futuro = +trip.serviceDate >= +hoy;
  if (trip.status === "CANCELLED") return { tono: "normal", label };
  if (trip.status === "COMPLETED") return { tono: "ok", label };
  if (trip.status === "PENDING") return futuro ? { tono: "atencion", label } : { tono: "grave", label: "Pendiente vencido" };
  if (trip.status === "CONFIRMED") return futuro && !tieneNave ? { tono: "atencion", label: "Confirmado · sin nave" } : { tono: "curso", label };
  return { tono: "normal", label };
}

/** Agrupa las filas por mes conservando el orden en que llegaron. */
export function agruparPorMes<T extends { serviceDate: Date }>(items: T[]) {
  const grupos: { clave: string; fecha: Date; items: T[] }[] = [];
  for (const item of items) {
    const clave = claveDia(item.serviceDate).slice(0, 7);
    const ultimo = grupos.at(-1);
    if (ultimo?.clave === clave) ultimo.items.push(item);
    else grupos.push({ clave, fecha: item.serviceDate, items: [item] });
  }
  return grupos;
}
