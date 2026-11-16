/**
 * Diferencia entre dos fotos de un registro para la auditoría: sólo los campos que cambiaron, con
 * el valor de antes y el de después. Un campo que quedó igual no se guarda.
 */

export type AuditChange = { before: unknown; after: unknown };
export type AuditChanges = Record<string, AuditChange>;

/** Campos que nunca se copian a la auditoría: se anota que cambiaron, no su valor. */
const SECRET_FIELD = /password|token|secret|googlesub/i;
export const HIDDEN_VALUE = "(oculto)";

function normalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  // Json de Prisma, Decimal, etc.: se guarda lo que quedaría serializado.
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/**
 * Aplana un registro con relaciones a un nivel: `{ payment: { status } }` → `{ "payment.status" }`.
 * Una relación ausente no aporta campos, así "no había pago" y "se creó el pago" se ven como
 * campos que pasan de vacío a tener valor.
 */
export function flattenRecord(record: Record<string, unknown> | null | undefined, prefix = ""): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  if (!record) return flat;
  for (const [key, value] of Object.entries(record)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value)) {
      Object.assign(flat, flattenRecord(value as Record<string, unknown>, name));
    } else {
      flat[name] = value;
    }
  }
  return flat;
}

/**
 * Compara dos fotos ya aplanadas. `null` como `before` es un alta (todo lo que tiene valor aparece
 * como nuevo) y `null` como `after` es una baja (queda la foto de lo que se borró).
 */
export function diffRecords(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): AuditChanges {
  const changes: AuditChanges = {};
  const previous = before ?? {};
  const next = after ?? {};
  for (const field of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const from = normalize(previous[field]);
    const to = normalize(next[field]);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes[field] = SECRET_FIELD.test(field)
      ? { before: from === null ? null : HIDDEN_VALUE, after: to === null ? null : HIDDEN_VALUE }
      : { before: from, after: to };
  }
  return changes;
}

export function hasChanges(changes: AuditChanges | null | undefined): changes is AuditChanges {
  return !!changes && Object.keys(changes).length > 0;
}
