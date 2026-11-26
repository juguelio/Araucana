/**
 * Ficha de una nave: lo que se arma a partir de los registros de una sola unidad.
 *
 * - Recorridos: una nave trabaja en cuatro áreas que guardan sus servicios en tablas distintas
 *   (salidas de ruta, viajes especiales, aeropuerto, Chapelco). Acá se juntan en una sola línea de
 *   tiempo para ver todo lo que hizo (y lo que tiene por delante) esa unidad.
 * - Vencimientos: el historial sale de la auditoría de la nave, que guarda cada fecha antes y después.
 * - Daños: estados y gravedades con su nombre en pantalla.
 *
 * Todo es puro (sin base de datos) para poder probarlo.
 */

import { extremoDelVuelo } from "@/lib/airport/airports";
import { statusLabel as estadoDeVuelo } from "@/lib/airport/flights";
import { statuses as ESTADO_VIAJE_ESPECIAL } from "@/lib/special-trips/data";

export type AreaDeRecorrido = "SALIDA" | "VIAJE_ESPECIAL" | "AEROPUERTO" | "CHAPELCO";

export const AREA_LABEL: Record<AreaDeRecorrido, string> = {
  SALIDA: "Salida de ruta",
  VIAJE_ESPECIAL: "Viaje especial",
  AEROPUERTO: "Aeropuerto",
  CHAPELCO: "Chapelco"
};

export type Recorrido = {
  /** Único en la lista: área + id del registro de origen. */
  key: string;
  area: AreaDeRecorrido;
  desde: Date;
  hasta: Date | null;
  /** Servicio de un día entero (Chapelco): `desde` es la medianoche UTC del día, sin hora. */
  soloDia: boolean;
  titulo: string;
  detalle: string | null;
  chofer: string | null;
  estado: string | null;
  href: string | null;
};

type Chofer = { name: string | null; email?: string | null } | null | undefined;

function nombreDeChofer(chofer: Chofer): string | null {
  if (!chofer) return null;
  return chofer.name?.trim() || chofer.email || null;
}

/** Día de servicio de Chapelco (se guarda como medianoche UTC) en formato de link: aaaa-mm-dd. */
function diaIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

const diaArgentina = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });

/** Día en Argentina de un instante (un vuelo de las 22 h sigue siendo de ese día, no del siguiente en UTC). */
function diaLocal(fecha: Date): string {
  return diaArgentina.format(fecha);
}

type Ruta = { id?: string; from: string; to: string };

export type FuentesDeRecorridos = {
  /** Salidas donde la nave es la principal (`Schedule.vehicleId`). */
  salidas: Array<{
    id: string;
    routeId: string;
    departureAt: Date;
    arrivalAt: Date;
    status: string;
    route: Ruta;
    driver?: Chofer;
    _count?: { reservations: number };
  }>;
  /** Salidas donde la nave se suma como unidad extra (`ScheduleUnit`). */
  unidadesExtra: Array<{
    id: string;
    driver?: Chofer;
    schedule: { id: string; routeId: string; departureAt: Date; arrivalAt: Date; status: string; route: Ruta };
  }>;
  viajesEspeciales: Array<{
    id: string;
    startsAt: Date;
    endsAt: Date;
    driver?: Chofer;
    trip: { id: string; client: string; status: string; passengers: number | null };
  }>;
  aeropuerto: Array<{
    id: string;
    driver?: Chofer;
    flight: { id: string; number: string; airline: string | null; origin: string; destination: string; direction: string; scheduledAt: Date; status?: string | null };
  }>;
  chapelco: Array<{
    id: string;
    status: string;
    capacity: number;
    driver?: Chofer;
    operationDay: { serviceDate: Date; route?: Ruta | null };
    _count?: { runs: number };
  }>;
};

const ESTADO_SALIDA: Record<string, string> = { OPEN: "Abierta", CLOSED: "Cerrada", CANCELLED: "Cancelada", DEPARTED: "Salió", COMPLETED: "Completada" };

/** Junta todos los servicios de la nave en una sola lista, del más nuevo al más viejo. */
export function recorridosDeNave(fuentes: FuentesDeRecorridos): Recorrido[] {
  const lista: Recorrido[] = [];

  for (const salida of fuentes.salidas) {
    const reservas = salida._count?.reservations;
    lista.push({
      key: `SALIDA:${salida.id}`,
      area: "SALIDA",
      desde: salida.departureAt,
      hasta: salida.arrivalAt,
      soloDia: false,
      titulo: `${salida.route.from} → ${salida.route.to}`,
      detalle: reservas === undefined ? "Nave principal" : `Nave principal · ${reservas} ${reservas === 1 ? "reserva" : "reservas"}`,
      chofer: nombreDeChofer(salida.driver),
      estado: ESTADO_SALIDA[salida.status] ?? salida.status,
      href: `/admin/rutas/${salida.routeId}/salidas/${salida.id}`
    });
  }

  for (const unidad of fuentes.unidadesExtra) {
    const salida = unidad.schedule;
    lista.push({
      key: `SALIDA_EXTRA:${unidad.id}`,
      area: "SALIDA",
      desde: salida.departureAt,
      hasta: salida.arrivalAt,
      soloDia: false,
      titulo: `${salida.route.from} → ${salida.route.to}`,
      detalle: "Unidad adicional de la salida",
      chofer: nombreDeChofer(unidad.driver),
      estado: ESTADO_SALIDA[salida.status] ?? salida.status,
      href: `/admin/rutas/${salida.routeId}/salidas/${salida.id}`
    });
  }

  for (const asignacion of fuentes.viajesEspeciales) {
    const pasajeros = asignacion.trip.passengers;
    lista.push({
      key: `VIAJE_ESPECIAL:${asignacion.id}`,
      area: "VIAJE_ESPECIAL",
      desde: asignacion.startsAt,
      hasta: asignacion.endsAt,
      soloDia: false,
      titulo: asignacion.trip.client,
      detalle: pasajeros ? `${pasajeros} ${pasajeros === 1 ? "pasajero" : "pasajeros"}` : null,
      chofer: nombreDeChofer(asignacion.driver),
      estado: ESTADO_VIAJE_ESPECIAL[asignacion.trip.status as keyof typeof ESTADO_VIAJE_ESPECIAL] ?? asignacion.trip.status,
      href: `/admin/viajes-especiales/${asignacion.trip.id}`
    });
  }

  for (const asignacion of fuentes.aeropuerto) {
    const vuelo = asignacion.flight;
    const llegada = vuelo.direction === "ARRIVAL";
    lista.push({
      key: `AEROPUERTO:${asignacion.id}`,
      area: "AEROPUERTO",
      desde: vuelo.scheduledAt,
      hasta: null,
      soloDia: false,
      titulo: `${llegada ? "Arribo" : "Salida"} vuelo ${vuelo.number}${vuelo.airline ? ` (${vuelo.airline})` : ""}`,
      detalle: `${llegada ? "Desde" : "Hacia"} ${extremoDelVuelo(vuelo)}`,
      chofer: nombreDeChofer(asignacion.driver),
      estado: vuelo.status ? estadoDeVuelo(vuelo.status) : null,
      href: `/admin/aeropuerto?date=${diaLocal(vuelo.scheduledAt)}`
    });
  }

  for (const turno of fuentes.chapelco) {
    const vueltas = turno._count?.runs;
    const ruta = turno.operationDay.route;
    lista.push({
      key: `CHAPELCO:${turno.id}`,
      area: "CHAPELCO",
      desde: turno.operationDay.serviceDate,
      hasta: null,
      soloDia: true,
      titulo: ruta ? `${ruta.from} → ${ruta.to}` : "Traslados al cerro",
      detalle: [`${turno.capacity} lugares`, vueltas === undefined ? null : `${vueltas} ${vueltas === 1 ? "vuelta" : "vueltas"}`].filter(Boolean).join(" · "),
      chofer: nombreDeChofer(turno.driver),
      estado: turno.status === "ACTIVE" ? "Activa" : turno.status,
      href: `/admin/chapelco?date=${diaIso(turno.operationDay.serviceDate)}`
    });
  }

  return lista.sort((a, b) => b.desde.getTime() - a.desde.getTime() || a.key.localeCompare(b.key));
}

export type FiltroDeRecorridos = "todos" | "proximos" | "pasados";

export function leerFiltroDeRecorridos(valor: string | string[] | undefined): FiltroDeRecorridos {
  return valor === "proximos" || valor === "pasados" ? valor : "todos";
}

export function leerAreaDeRecorrido(valor: string | string[] | undefined): AreaDeRecorrido | null {
  return typeof valor === "string" && Object.hasOwn(AREA_LABEL, valor) ? (valor as AreaDeRecorrido) : null;
}

/**
 * Filtra por momento y por área. Un recorrido es «próximo» mientras no terminó: el que está en
 * curso todavía cuenta como por delante. Los próximos se muestran del más cercano al más lejano.
 */
export function filtrarRecorridos(
  recorridos: readonly Recorrido[],
  filtro: FiltroDeRecorridos,
  area: AreaDeRecorrido | null,
  ahora: Date = new Date()
): Recorrido[] {
  // Un día de Chapelco termina a la medianoche de Argentina: 27 h después de la medianoche UTC.
  const fin = (r: Recorrido) => (r.hasta ?? r.desde).getTime() + (r.soloDia ? 27 * 3600 * 1000 : 0);
  const porArea = area ? recorridos.filter((r) => r.area === area) : [...recorridos];
  if (filtro === "proximos") return porArea.filter((r) => fin(r) >= ahora.getTime()).reverse();
  if (filtro === "pasados") return porArea.filter((r) => fin(r) < ahora.getTime());
  return porArea;
}

/** Cuántos recorridos hay por área (para los contadores de la ficha). */
export function contarPorArea(recorridos: readonly Recorrido[]): Record<AreaDeRecorrido, number> {
  const cuenta: Record<AreaDeRecorrido, number> = { SALIDA: 0, VIAJE_ESPECIAL: 0, AEROPUERTO: 0, CHAPELCO: 0 };
  for (const recorrido of recorridos) cuenta[recorrido.area] += 1;
  return cuenta;
}

// ── Vencimientos: historial desde la auditoría ──────────────────────────────────────────────────

/** Campos de la ficha que hacen al seguro y los papeles, con su nombre en pantalla. */
export const CAMPOS_DE_PAPELES = {
  technicalInspectionDueAt: "Técnica (VTV)",
  rtoDueAt: "RTO",
  policyDueAt: "Póliza",
  insurer: "Aseguradora",
  publicTransport: "Transporte público"
} as const;

export type CampoDePapeles = keyof typeof CAMPOS_DE_PAPELES;

export type CambioDePapeles = {
  key: string;
  fecha: Date;
  quien: string | null;
  campo: CampoDePapeles;
  titulo: string;
  antes: unknown;
  despues: unknown;
};

type FilaDeAuditoria = {
  id: string;
  createdAt: Date;
  actorName: string | null;
  actorEmail?: string | null;
  changes: unknown;
};

/**
 * Cada cambio de vencimiento, aseguradora o habilitación que quedó en la auditoría de la nave, del
 * más nuevo al más viejo. El alta de la nave también cuenta (pasa de «sin dato» a la fecha cargada).
 */
export function historialDePapeles(filas: readonly FilaDeAuditoria[]): CambioDePapeles[] {
  const cambios: CambioDePapeles[] = [];
  for (const fila of filas) {
    if (!fila.changes || typeof fila.changes !== "object") continue;
    const registro = fila.changes as Record<string, { before?: unknown; after?: unknown } | undefined>;
    for (const campo of Object.keys(CAMPOS_DE_PAPELES) as CampoDePapeles[]) {
      const cambio = registro[campo];
      if (!cambio || typeof cambio !== "object") continue;
      const antes = cambio.before ?? null;
      const despues = cambio.after ?? null;
      if (antes === null && despues === null) continue;
      cambios.push({
        key: `${fila.id}:${campo}`,
        fecha: fila.createdAt,
        quien: fila.actorName?.trim() || fila.actorEmail || null,
        campo,
        titulo: CAMPOS_DE_PAPELES[campo],
        antes,
        despues
      });
    }
  }
  return cambios.sort((a, b) => b.fecha.getTime() - a.fecha.getTime() || a.key.localeCompare(b.key));
}

/** Valor de la auditoría en pantalla: las fechas vienen como ISO; sí/no para la habilitación. */
export function valorDePapel(campo: CampoDePapeles, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "sin dato";
  if (campo === "publicTransport") return valor === true ? "Sí" : "No";
  if (campo === "insurer") return String(valor);
  const fecha = new Date(String(valor));
  if (Number.isNaN(fecha.getTime())) return String(valor);
  // Las fechas de vencimiento se guardan como medianoche UTC: se muestran en UTC para no correr el día.
  const d = String(fecha.getUTCDate()).padStart(2, "0");
  const m = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${fecha.getUTCFullYear()}`;
}

// ── Daños ───────────────────────────────────────────────────────────────────────────────────────

export const GRAVEDADES = ["LEVE", "MODERADO", "GRAVE"] as const;
export type Gravedad = (typeof GRAVEDADES)[number];
export const GRAVEDAD_LABEL: Record<Gravedad, string> = { LEVE: "Leve", MODERADO: "Moderado", GRAVE: "Grave" };

export const ESTADOS_DE_DANIO = ["PENDIENTE", "EN_REPARACION", "REPARADO"] as const;
export type EstadoDeDanio = (typeof ESTADOS_DE_DANIO)[number];
export const ESTADO_DANIO_LABEL: Record<EstadoDeDanio, string> = {
  PENDIENTE: "Pendiente",
  EN_REPARACION: "En reparación",
  REPARADO: "Reparado"
};

export function esGravedad(valor: unknown): valor is Gravedad {
  return typeof valor === "string" && (GRAVEDADES as readonly string[]).includes(valor);
}

export function esEstadoDeDanio(valor: unknown): valor is EstadoDeDanio {
  return typeof valor === "string" && (ESTADOS_DE_DANIO as readonly string[]).includes(valor);
}

/** Un daño sigue abierto mientras no está reparado. */
export function danioAbierto(danio: { status: string }): boolean {
  return danio.status !== "REPARADO";
}

/** Resumen para la ficha: cuántos daños hay abiertos y si alguno es grave. */
export function resumenDeDanios(danios: ReadonlyArray<{ status: string; severity: string }>) {
  const abiertos = danios.filter(danioAbierto);
  return { total: danios.length, abiertos: abiertos.length, graves: abiertos.filter((d) => d.severity === "GRAVE").length };
}

/**
 * Lee el formulario de un daño. Devuelve los datos limpios o los errores por campo.
 * La fecha llega como aaaa-mm-dd y se guarda a las 12:00 de Argentina, así no se corre de día.
 */
export function leerDanio(input: { occurredAt?: string; description?: string; severity?: string; reportedBy?: string; notes?: string }):
  | { ok: true; data: { occurredAt: Date; description: string; severity: Gravedad; reportedBy: string | null; notes: string | null } }
  | { ok: false; errores: Record<string, string> } {
  const errores: Record<string, string> = {};
  const descripcion = input.description?.trim() ?? "";
  if (!descripcion) errores.description = "Contá qué se dañó.";
  if (descripcion.length > 500) errores.description = "Máximo 500 caracteres.";
  const fechaTexto = input.occurredAt?.trim() ?? "";
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaTexto) ? new Date(`${fechaTexto}T12:00:00.000-03:00`) : null;
  if (!fecha || Number.isNaN(fecha.getTime())) errores.occurredAt = "Elegí la fecha del daño.";
  const gravedad = input.severity?.trim() || "LEVE";
  if (!esGravedad(gravedad)) errores.severity = "Elegí una gravedad válida.";
  if (Object.keys(errores).length > 0 || !fecha || !esGravedad(gravedad)) return { ok: false, errores };
  return {
    ok: true,
    data: {
      occurredAt: fecha,
      description: descripcion,
      severity: gravedad,
      reportedBy: input.reportedBy?.trim().slice(0, 120) || null,
      notes: input.notes?.trim().slice(0, 1000) || null
    }
  };
}
