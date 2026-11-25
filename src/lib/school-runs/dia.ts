/**
 * El día de Concesiones (rediseño del 24-nov): los servicios agrupados por horario, qué falta
 * resolver (nave, chofer, la nota de «pendiente de revisión») y los choques entre servicios.
 *
 * Los servicios de Concesiones no tienen duración: sólo un turno, que la planilla escribe como hora
 * («07:30») o como nombre («Mañana», «Jornada completa»). Por eso un choque **seguro** es el mismo
 * chofer o la misma nave en dos servicios del mismo horario; uno **posible** es cuando uno de los dos
 * es un turno con nombre que cubre al otro (la jornada completa cubre todo el día; la mañana, una hora
 * de la mañana). Dos horas distintas no se marcan: sin duración, sería adivinar.
 */

import type { EstadoDeOpcion } from "@/lib/fleet/ocupacion";
import { normalizarNombre } from "./import-key";

export type TurnoLeido = {
  /** Lo que se compara: «07:30», «manana», «jornada completa». */
  clave: string;
  /** Lo que se muestra como título del grupo. */
  etiqueta: string;
  /** Orden del grupo en el día. */
  orden: number;
  /** Minutos desde medianoche si el turno es una hora. */
  minutos: number | null;
  /** Rango que cubre un turno con nombre, en minutos [desde, hasta). */
  cubre: [number, number] | null;
};

const TURNOS_CON_NOMBRE: Record<string, { etiqueta: string; orden: number; cubre: [number, number] }> = {
  // Cada turno con nombre va donde empieza: la jornada completa arriba de todo, la mañana antes de
  // las horas de la mañana, la tarde antes de las 13:00.
  "jornada completa": { etiqueta: "Jornada completa", orden: -1, cubre: [0, 24 * 60] },
  "full day": { etiqueta: "Jornada completa", orden: -1, cubre: [0, 24 * 60] },
  manana: { etiqueta: "Mañana", orden: 5 * 60 - 0.5, cubre: [5 * 60, 13 * 60] },
  tarde: { etiqueta: "Tarde", orden: 13 * 60 - 0.5, cubre: [13 * 60, 20 * 60] },
  noche: { etiqueta: "Noche", orden: 20 * 60 - 0.5, cubre: [20 * 60, 24 * 60] }
};

/** «07:30», «7.30», «7:30 hs», «07 hs», «Mañana», «full day», «Sin horario». Lo que no se reconoce va después de las horas. */
export function leerTurno(shift: string | null | undefined): TurnoLeido {
  const texto = String(shift ?? "").trim();
  const hora = /^(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?\s*(?:hs?\.?|horas?)?$/i.exec(texto);
  if (hora) {
    const h = Number(hora[1]);
    const m = Number(hora[2] ?? 0);
    if (h < 24 && m < 60) {
      const etiqueta = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      return { clave: etiqueta, etiqueta, orden: h * 60 + m, minutos: h * 60 + m, cubre: null };
    }
  }
  const normal = normalizarNombre(texto);
  const conNombre = TURNOS_CON_NOMBRE[normal];
  if (conNombre) return { clave: conNombre.etiqueta.toLowerCase(), etiqueta: conNombre.etiqueta, orden: conNombre.orden, minutos: null, cubre: conNombre.cubre };
  if (!normal || normal === "sin horario") return { clave: "", etiqueta: "Sin horario", orden: 20_000, minutos: null, cubre: null };
  return { clave: normal, etiqueta: texto, orden: 15_000, minutos: null, cubre: null };
}

/** ¿Se pisan dos turnos? `seguro`: mismo horario; `posible`: uno con nombre cubre al otro. */
export function solapeDeTurnos(a: TurnoLeido, b: TurnoLeido): "seguro" | "posible" | null {
  if (!a.clave || !b.clave) return null; // sin horario no se puede decir nada
  if (a.clave === b.clave) return "seguro";
  const cubre = (turno: TurnoLeido, otro: TurnoLeido) => {
    if (!turno.cubre) return false;
    if (otro.minutos !== null) return otro.minutos >= turno.cubre[0] && otro.minutos < turno.cubre[1];
    if (otro.cubre) return otro.cubre[0] < turno.cubre[1] && turno.cubre[0] < otro.cubre[1];
    return false;
  };
  return cubre(a, b) || cubre(b, a) ? "posible" : null;
}

export type ServicioDelDia = {
  id: string;
  routeName: string;
  shift: string;
  driverId: string | null;
  vehicleId: string | null;
  review: string | null;
};

export type Choque = {
  recurso: "chofer" | "nave";
  seguro: boolean;
  /** El otro servicio. */
  conId: string;
  /** «07:30 · Primaria Quila Quina». */
  detalle: string;
};

/** Para cada servicio, con qué otros del día choca por chofer o por nave. */
export function choquesDelDia(servicios: readonly ServicioDelDia[]): Map<string, Choque[]> {
  const turnos = new Map(servicios.map((s) => [s.id, leerTurno(s.shift)]));
  const choques = new Map<string, Choque[]>();
  for (let i = 0; i < servicios.length; i++) {
    for (let j = i + 1; j < servicios.length; j++) {
      const a = servicios[i];
      const b = servicios[j];
      const solape = solapeDeTurnos(turnos.get(a.id)!, turnos.get(b.id)!);
      if (!solape) continue;
      for (const recurso of ["chofer", "nave"] as const) {
        const deA = recurso === "chofer" ? a.driverId : a.vehicleId;
        const deB = recurso === "chofer" ? b.driverId : b.vehicleId;
        if (!deA || deA !== deB) continue;
        const anotar = (de: ServicioDelDia, con: ServicioDelDia) => {
          const lista = choques.get(de.id) ?? [];
          lista.push({ recurso, seguro: solape === "seguro", conId: con.id, detalle: `${turnos.get(con.id)!.etiqueta} · ${con.routeName}` });
          choques.set(de.id, lista);
        };
        anotar(a, b);
        anotar(b, a);
      }
    }
  }
  return choques;
}

export type EstadoDelServicio = "falta" | "choque" | "revisar" | "listo";

/** Lo más urgente primero: falta nave o chofer, un choque seguro, una nota de revisión. */
export function estadoDelServicio(servicio: ServicioDelDia, choques: readonly Choque[] = []): EstadoDelServicio {
  if (!servicio.vehicleId || !servicio.driverId) return "falta";
  if (choques.some((choque) => choque.seguro)) return "choque";
  if (servicio.review?.trim() || choques.length) return "revisar";
  return "listo";
}

export const FILTROS_DEL_DIA = ["todos", "falta", "choque", "revisar"] as const;
export type FiltroDelDia = (typeof FILTROS_DEL_DIA)[number];

export function leerFiltroDelDia(valor: unknown): FiltroDelDia {
  return (FILTROS_DEL_DIA as readonly string[]).includes(String(valor ?? "")) ? (valor as FiltroDelDia) : "todos";
}

/** Agrupa por horario, en el orden del día; dentro de cada horario, por nombre. */
export function agruparPorTurno<T extends { shift: string; routeName: string }>(servicios: readonly T[]): { turno: TurnoLeido; servicios: T[] }[] {
  const grupos = new Map<string, { turno: TurnoLeido; servicios: T[] }>();
  for (const servicio of servicios) {
    const turno = leerTurno(servicio.shift);
    const clave = `${turno.orden}|${turno.clave}`;
    const grupo = grupos.get(clave) ?? { turno, servicios: [] };
    grupo.servicios.push(servicio);
    grupos.set(clave, grupo);
  }
  return [...grupos.values()]
    .sort((a, b) => a.turno.orden - b.turno.orden || a.turno.etiqueta.localeCompare(b.turno.etiqueta, "es"))
    .map((grupo) => ({ ...grupo, servicios: grupo.servicios.sort((a, b) => a.routeName.localeCompare(b.routeName, "es", { numeric: true })) }));
}

/**
 * Lo que el selector de nave y chofer muestra para un servicio: qué naves y choferes ya están en otro
 * servicio de Concesiones a ese horario. Se suma a la ocupación del resto de la operación (`otros`),
 * quedándose con lo más grave.
 */
export function ocupacionParaServicio(
  servicio: ServicioDelDia,
  servicios: readonly ServicioDelDia[],
  otros: { naves: Record<string, EstadoDeOpcion>; choferes: Record<string, EstadoDeOpcion> } = { naves: {}, choferes: {} }
) {
  const naves: Record<string, EstadoDeOpcion> = { ...otros.naves };
  const choferes: Record<string, EstadoDeOpcion> = { ...otros.choferes };
  const turno = leerTurno(servicio.shift);
  const anotar = (destino: Record<string, EstadoDeOpcion>, id: string | null, estado: EstadoDeOpcion) => {
    if (!id) return;
    const previo = destino[id];
    if (!previo || (previo.estado === "posible" && estado.estado === "ocupada")) destino[id] = estado;
  };
  for (const otro of servicios) {
    if (otro.id === servicio.id) continue;
    const solape = solapeDeTurnos(turno, leerTurno(otro.shift));
    if (!solape) continue;
    const estado: EstadoDeOpcion = { estado: solape === "seguro" ? "ocupada" : "posible", detalle: `Concesiones ${leerTurno(otro.shift).etiqueta} · ${otro.routeName}` };
    anotar(naves, otro.vehicleId, estado);
    anotar(choferes, otro.driverId, estado);
  }
  return { naves, choferes };
}

/** «Ana Pérez» → «Ana P.»: para los chips donde no entra el nombre completo. */
export function nombreCorto(nombre: string) {
  const partes = nombre.trim().split(/\s+/);
  return partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1][0]}.` : nombre.trim();
}
