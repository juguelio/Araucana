import type { Prisma } from "@prisma/client";
import { leerOrden, type OrdenDeListado } from "@/lib/admin/list-order";
import { auditActions, auditEntities, type AuditAction, type AuditEntity } from "./record";

export const AUDIT_PAGE_SIZE = 50;

export type AuditFilters = {
  q?: string;
  entity?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: string;
  orden?: string;
  dir?: string;
};

/** Columnas ordenables de la auditoría (issue #192). Por defecto, lo más reciente arriba. */
export const AUDIT_ORDER_COLUMNS = ["fecha", "quien", "accion", "sobre"] as const;
export type AuditOrderColumn = (typeof AUDIT_ORDER_COLUMNS)[number];
const AUDIT_DEFAULT_ORDER: OrdenDeListado<AuditOrderColumn> = { columna: "fecha", direccion: "desc" };

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
  const orden = leerOrden(AUDIT_ORDER_COLUMNS, AUDIT_DEFAULT_ORDER, filters);
  return { q, entity, action, from, to, page, orden };
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

/**
 * `orderBy` de Prisma para la columna pedida. Los campos opcionales dejan los vacíos al final y todo
 * cierra con fecha e id, para que dos registros iguales no salten de página entre pedidos.
 */
export function auditOrderBy({ columna, direccion }: OrdenDeListado<AuditOrderColumn>): Prisma.AuditLogOrderByWithRelationInput[] {
  const desempate: Prisma.AuditLogOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];
  switch (columna) {
    case "fecha": return [{ createdAt: direccion }, { id: direccion }];
    case "quien": return [{ actorName: { sort: direccion, nulls: "last" } }, { actorEmail: { sort: direccion, nulls: "last" } }, ...desempate];
    case "accion": return [{ action: direccion }, ...desempate];
    case "sobre": return [{ entityLabel: { sort: direccion, nulls: "last" } }, ...desempate];
  }
}

/** Enlace de paginación que conserva los filtros y el orden. */
export function auditPageHref(filters: ParsedAuditFilters, page: number) {
  const params = new URLSearchParams();
  for (const key of ["q", "entity", "action", "from", "to"] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  params.set("orden", filters.orden.columna);
  params.set("dir", filters.orden.direccion);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/admin/auditoria${query ? `?${query}` : ""}`;
}
