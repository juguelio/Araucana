import { diffRecords, hasChanges, type AuditChanges } from "./diff";
import { recordAudit, type AuditAction, type AuditActor, type AuditClient, type AuditEntity } from "./record";

/** Campos técnicos que no son decisión de nadie y no entran a la foto. */
const TECHNICAL_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

type Loose = Record<string, unknown>;

/**
 * Foto genérica de un registro: sus datos propios (texto, números, fechas, sí/no). Las relaciones
 * cargadas con `include` quedan afuera salvo las que se nombren en `json` (por ejemplo las paradas
 * de una ruta, que son un JSON del propio registro).
 */
export function entitySnapshot(record: Loose | null | undefined, json: readonly string[] = []): Loose | null {
  if (!record) return null;
  const snapshot: Loose = {};
  for (const [field, value] of Object.entries(record)) {
    if (TECHNICAL_FIELDS.has(field) || field.startsWith("_")) continue;
    const scalar = value === null || value instanceof Date || ["string", "number", "boolean"].includes(typeof value);
    if (scalar || json.includes(field)) snapshot[field] = value;
  }
  return snapshot;
}

export type EntityAudit = {
  actor?: AuditActor | null;
  entity: AuditEntity;
  entityId?: string | null;
  entityLabel?: string | null;
  summary: string;
  /** Sin `before` es un alta; sin `after`, una baja. */
  before?: Loose | null;
  after?: Loose | null;
  json?: readonly string[];
  /** Para cuando la acción no es un alta/edición/baja lisa (por ejemplo cancelar). */
  action?: AuditAction;
  /** Cambios que no salen de comparar el registro: asientos de una nave, unidades asignadas. */
  extra?: AuditChanges;
};

/**
 * Registra el cambio de un registro cualquiera del panel. Una edición que comparó antes y después y
 * no cambió nada no deja fila. Devuelve si escribió.
 */
export async function recordEntityAudit(client: AuditClient, audit: EntityAudit) {
  const before = entitySnapshot(audit.before, audit.json);
  const after = entitySnapshot(audit.after, audit.json);
  const changes = { ...diffRecords(before, after), ...(audit.extra ?? {}) };
  const action = audit.action ?? (!audit.before ? "CREATE" : !audit.after ? "DELETE" : "UPDATE");
  // Sólo se descarta la edición que comparó dos fotos y no encontró diferencias. Un hecho sin fotos
  // (se guardó una clave, se cambió la foto principal) se registra igual, con su resumen.
  const compared = audit.before !== undefined && audit.after !== undefined;
  if (action === "UPDATE" && compared && !hasChanges(changes)) return false;
  await recordAudit(client, {
    actor: audit.actor,
    action,
    entity: audit.entity,
    entityId: audit.entityId,
    entityLabel: audit.entityLabel,
    summary: audit.summary,
    changes
  });
  return true;
}

/**
 * Igual, pero para operaciones cuya escritura ya quedó confirmada en su propia transacción (las de
 * la operación diaria, que viven en repositorios con su propia lógica de bloqueos): si la auditoría
 * falla, se anota en el log y la operación sigue en pie, en vez de mostrar un error por algo que sí
 * se guardó.
 */
export async function recordEntityAuditAfterCommit(client: AuditClient, audit: EntityAudit) {
  try {
    return await recordEntityAudit(client, audit);
  } catch (error) {
    console.error(JSON.stringify({ evento: "auditoria_fallida", entidad: audit.entity, error: error instanceof Error ? error.name : "desconocido" }));
    return false;
  }
}

/** Antes y después de una lista corta (asientos, unidades): se guarda como texto legible. */
export function listChange(before: readonly string[] | null, after: readonly string[] | null): AuditChanges[string] | null {
  const from = before ? [...before].sort().join(", ") : null;
  const to = after ? [...after].sort().join(", ") : null;
  return from === to ? null : { before: from, after: to };
}

/**
 * Lectura para armar la foto de antes o de después alrededor de una operación ya confirmada. Si
 * falla devuelve `null`: una foto que no se pudo leer no puede romper la operación.
 */
export async function readForAudit<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}
