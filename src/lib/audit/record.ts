import { hasChanges, type AuditChanges } from "./diff";

/**
 * Quién hizo el cambio. Se copia a la fila tal como era en ese momento: si después la cuenta cambia
 * de rol o se borra, la auditoría sigue diciendo quién fue. `null` es un proceso del sistema; un
 * pedido sin sesión (reserva pública) se registra con `guestActor`.
 */
export type AuditActor = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  role: string;
};

export const guestActor: AuditActor = { role: "GUEST" };

export const auditEntities = [
  "SESSION", "RESERVATION", "ACCOUNTING_ENTRY", "USER",
  "ROUTE", "VEHICLE", "SCHEDULE", "EXCURSION", "DEPARTURE_SHEET", "SPECIAL_TRIP", "AIRPORT", "CHAPELCO"
] as const;
export type AuditEntity = (typeof auditEntities)[number];

export const auditActions = [
  "LOGIN", "LOGIN_FAILED", "LOGOUT", "REGISTER",
  "CREATE", "UPDATE", "DELETE", "IMPORT", "EXPORT", "VIEW",
  "CANCEL", "RESTORE", "CONFIRM",
  "PAYMENT_REGISTERED", "PAYMENT_APPROVED", "PAYMENT_REJECTED",
  "DOCUMENT_APPROVED", "DOCUMENT_REJECTED"
] as const;
export type AuditAction = (typeof auditActions)[number];

export type AuditEntry = {
  actor?: AuditActor | null;
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string | null;
  entityLabel?: string | null;
  summary: string;
  changes?: AuditChanges | null;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Lo mínimo que hace falta para escribir: el cliente de Prisma o el de una transacción. `auditLog`
 * es opcional porque los repositorios se prueban con clientes falsos que no lo traen; en la app
 * siempre está.
 */
export type AuditClient = { auditLog?: { create(args: { data: Record<string, unknown> }): Promise<unknown> } };

function clip(value: string | null | undefined, max: number) {
  const text = value?.trim();
  return text ? text.slice(0, max) : null;
}

export function auditRow(entry: AuditEntry) {
  const actor = entry.actor ?? null;
  return {
    actorId: actor?.id ?? null,
    actorName: clip(actor?.name, 120),
    actorEmail: clip(actor?.email, 254),
    actorRole: actor?.role ?? "SYSTEM",
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    entityLabel: clip(entry.entityLabel, 254),
    summary: entry.summary.slice(0, 300),
    ...(hasChanges(entry.changes) ? { changes: entry.changes } : {}),
    ip: clip(entry.ip, 64),
    userAgent: clip(entry.userAgent, 300)
  };
}

/**
 * Escribe una fila de auditoría. Pensado para llamarse con el `tx` de la misma transacción que hace
 * el cambio: si la auditoría falla, el cambio no queda, y al revés.
 */
export async function recordAudit(client: AuditClient, entry: AuditEntry) {
  if (!client.auditLog) return;
  await client.auditLog.create({ data: auditRow(entry) });
}

/**
 * Variante para los accesos (login, logout): un problema al auditar no puede dejar a nadie afuera,
 * así que el error se anota en el log y se sigue.
 */
export async function recordAuditBestEffort(client: AuditClient, entry: AuditEntry) {
  try {
    await recordAudit(client, entry);
  } catch (error) {
    console.error(JSON.stringify({ evento: "auditoria_fallida", accion: entry.action, error: error instanceof Error ? error.name : "desconocido" }));
  }
}

/** IP y navegador del pedido, para los accesos. Misma lectura de IP que el freno de ráfagas. */
export function requestOrigin(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || null;
  return { ip, userAgent: request.headers.get("user-agent") };
}
