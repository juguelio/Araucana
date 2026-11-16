import type { Prisma } from "@prisma/client";
import { auditActions, auditEntities, type AuditAction, type AuditEntity } from "./record";

export const AUDIT_PAGE_SIZE = 50;

export type AuditFilters = {
  q?: string;
  entity?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Medianoche argentina (UTC-3, sin horario de verano) de un día `AAAA-MM-DD`. */
function startOfArgentineDay(day: string) {
  const date = new Date(`${day}T00:00:00-03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseAuditFilters(filters: AuditFilters) {
  const q = filters.q?.trim().slice(0, 120) ?? "";
  const entity = auditEntities.includes(filters.entity as AuditEntity) ? (filters.entity as AuditEntity) : "";
  const action = auditActions.includes(filters.action as AuditAction) ? (filters.action as AuditAction) : "";
  const from = filters.from && DAY.test(filters.from) && startOfArgentineDay(filters.from) ? filters.from : "";
  const to = filters.to && DAY.test(filters.to) && startOfArgentineDay(filters.to) ? filters.to : "";
  const page = Math.min(Math.max(Math.floor(Number(filters.page)) || 1, 1), 10_000);
  return { q, entity, action, from, to, page };
}

export type ParsedAuditFilters = ReturnType<typeof parseAuditFilters>;

export function auditWhere(filters: ParsedAuditFilters): Prisma.AuditLogWhereInput {
  const since = filters.from ? startOfArgentineDay(filters.from) : null;
  const untilStart = filters.to ? startOfArgentineDay(filters.to) : null;
  // "Hasta" incluye todo ese día: el límite es la medianoche siguiente.
  const until = untilStart ? new Date(untilStart.getTime() + 24 * 3600 * 1000) : null;
  const contains = { contains: filters.q, mode: "insensitive" as const };
  return {
    ...(filters.entity ? { entity: filters.entity } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(since || until ? { createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lt: until } : {}) } } : {}),
    ...(filters.q
      ? { OR: [{ actorName: contains }, { actorEmail: contains }, { entityLabel: contains }, { summary: contains }, { ip: contains }] }
      : {})
  };
}

/** Enlace de paginación que conserva los filtros. */
export function auditPageHref(filters: ParsedAuditFilters, page: number) {
  const params = new URLSearchParams();
  for (const key of ["q", "entity", "action", "from", "to"] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/admin/auditoria${query ? `?${query}` : ""}`;
}
