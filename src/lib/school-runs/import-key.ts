/**
 * Clave con la que se reconoce el mismo servicio de Concesiones entre la planilla y la base.
 *
 * En producción conviven dos formas de `SchoolRun.source`: la que escribe esta importación
 * (`driver1`/`driver2`/`status`) y otra anterior con `driver`/`companion` y el turno ya
 * normalizado («full day» → «Jornada completa»). Comparar sólo `driver1` contra `driver1` hacía
 * que cada reimportación creyera que las 274 filas existentes eran nuevas y las duplicara (#407).
 *
 * Dos servicios son el mismo cuando coinciden fecha, recorrido, turno equivalente y las dos
 * personas. La identidad del chofer se acepta por id de usuario o por nombre, porque una de las
 * dos formas puede no traer el nombre tal como está en `User`.
 */

export type PersonaDeServicio = { id?: string | null; nombre?: string | null };

export type ServicioParaClave = {
  serviceDate: Date | string;
  routeName: string;
  shift: string;
  chofer1: PersonaDeServicio;
  chofer2: PersonaDeServicio;
};

/** Fila de `SchoolRun` guardada en la base, con la forma vieja o la nueva de `source`. */
export type ServicioGuardadoParaClave = {
  serviceDate: Date | string;
  routeName: string;
  shift: string;
  driverId?: string | null;
  companion?: string | null;
  source?: unknown;
};

export function normalizarNombre(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Turnos que la planilla y la base escriben distinto pero significan lo mismo. */
const TURNOS_EQUIVALENTES: Record<string, string> = {
  "full day": "jornada completa",
  "jornada completa": "jornada completa"
};

export function turnoParaClave(value: unknown) {
  const normalizado = normalizarNombre(value);
  return TURNOS_EQUIVALENTES[normalizado] ?? normalizado;
}

function fechaParaClave(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

/**
 * Claves candidatas del servicio: una por identidad de chofer (usuario) y otra por nombre.
 * Alcanza con que una coincida para considerarlo el mismo servicio.
 */
export function clavesDeServicio(servicio: ServicioParaClave): string[] {
  const base = [fechaParaClave(servicio.serviceDate), servicio.routeName.trim(), turnoParaClave(servicio.shift)];
  const nombre1 = normalizarNombre(servicio.chofer1.nombre);
  const nombre2 = normalizarNombre(servicio.chofer2.nombre);
  const segunda = nombre2 ? `nombre:${nombre2}` : "sin-segunda";
  const claves = new Set<string>();
  if (servicio.chofer1.id) claves.add([...base, `id:${servicio.chofer1.id}`, segunda].join("|"));
  if (nombre1) claves.add([...base, `nombre:${nombre1}`, segunda].join("|"));
  if (!claves.size) claves.add([...base, "sin-chofer", segunda].join("|"));
  return [...claves];
}

/**
 * Claves de una fila ya guardada, leyendo las dos formas de `source`.
 * `idPorNombre` resuelve el usuario del chofer cuando la fila vieja no lo tiene; `nombrePorId`
 * aporta el nombre cuando la fila tiene el id pero `source` no trae el texto.
 */
export function clavesDeServicioGuardado(
  run: ServicioGuardadoParaClave,
  opciones: { idPorNombre?: (nombre: string) => string | null; nombrePorId?: (id: string) => string | null } = {}
) {
  const source = run.source && typeof run.source === "object" && !Array.isArray(run.source)
    ? (run.source as Record<string, unknown>)
    : {};
  const nombre1 = String(source.driver1 ?? source.driver ?? "");
  const nombre2 = String(source.driver2 ?? source.companion ?? run.companion ?? "");
  const driverId = run.driverId ?? opciones.idPorNombre?.(nombre1) ?? null;
  const nombreDelId = driverId ? opciones.nombrePorId?.(driverId) ?? "" : "";
  return clavesDeServicio({
    serviceDate: run.serviceDate,
    routeName: run.routeName,
    shift: run.shift,
    chofer1: { id: driverId, nombre: nombre1 || nombreDelId },
    chofer2: { nombre: nombre2 }
  });
}
