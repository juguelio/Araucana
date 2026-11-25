import type { NaveApp, ServicioApp } from "@/lib/driver/jornada-app-types";
import type { Copia, MarcaWeb } from "./almacen";

export const claveServicio = (s: ServicioApp) => JSON.stringify([s.id, s.nave?.id ?? null, s.fecha]);
export const diaLocal = (ms: number) => new Date(ms - 3 * 3600000).toISOString().slice(0, 10);

export function nombreNave(nave: NaveApp | null) {
  return nave ? [nave.nombre, nave.interno && "Int. " + nave.interno, nave.patente].filter(Boolean).join(" · ") : "Nave pendiente de asignación";
}

const formatoHora = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const hora = (fecha: string | null) => fecha ? formatoHora.format(new Date(fecha)) : "Sin horario";

export function enHorario(s: ServicioApp, ahora: number) {
  return Boolean(s.salida && s.fin && Date.parse(s.salida) <= ahora && ahora < Date.parse(s.fin));
}

export function admiteGPSManual(s: ServicioApp, ahora: number) {
  return s.fecha === diaLocal(ahora) && Boolean(s.nave) && (!s.salida || !s.fin) &&
    (!s.salida || Date.parse(s.salida) <= ahora) && (!s.fin || ahora < Date.parse(s.fin));
}

export function objetivoGPS(servicios: ServicioApp[], ahora: number, claveManual: string | null) {
  const activos = servicios.filter(s => s.fecha === diaLocal(ahora) && enHorario(s, ahora));
  const elegido = servicios.find(s => claveServicio(s) === claveManual && admiteGPSManual(s, ahora));
  const candidatos = elegido ? [...activos, elegido] : activos;
  const naves = new Set(candidatos.map(s => s.nave?.id ?? null));
  const conflicto = naves.size > 1;
  const servicio = conflicto || naves.has(null) ? null : activos[0] ?? elegido ?? null;
  return { servicio, conflicto, manual: servicio != null && !activos.length };
}

export function marcasFila(marcas: MarcaWeb[], s: ServicioApp, filaId: string) {
  const porNave = new Map<string | null, MarcaWeb>();
  const ordenadas = marcas.filter(m => m.servicioId === s.id && m.fecha === s.fecha && m.filaId === filaId && m.tipo === "embarque" && m.estado !== "revision")
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  for (const m of ordenadas) porNave.set(m.vehicleId, m);
  const propia = porNave.get(s.nave?.id ?? null);
  const enOtras = [...porNave.values()].reduce((n, m) => n + (m.vehicleId === s.nave?.id ? 0 : m.cantidad ?? 0), 0);
  return { propia, enOtras };
}

export function copiaParaGuardar(copia: Copia, anterior?: Copia): Copia {
  // Una pestaña que se refresca conserva las hojas que el chofer abrió en otra.
  const vigente = anterior && anterior.sincronizada > copia.sincronizada ? anterior : copia;
  const abiertas = new Set([...copia.hojas, ...anterior?.hojas ?? []]);
  const hojas = vigente.jornada.servicios.map(claveServicio).filter(k => abiertas.has(k));
  const completas = new Map([...copia.jornada.servicios, ...anterior?.jornada.servicios ?? []]
    .filter(s => s.comprobante).map(s => [claveServicio(s), s]));
  const servicios = vigente.jornada.servicios.map(s => {
    if (abiertas.has(claveServicio(s))) return s.comprobante ? s : completas.get(claveServicio(s)) ?? s;
    return { ...s, filas: [], indicaciones: [], paradas: [], comprobante: undefined };
  });
  return { ...vigente, hojas, jornada: { ...vigente.jornada, servicios } };
}
