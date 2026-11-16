import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { auditActionLabels, auditChangeLines, auditEntityLabels, auditRoleLabel, formatAuditDate } from "@/lib/audit/labels";
import { AUDIT_PAGE_SIZE, auditPageHref, auditWhere, parseAuditFilters, type AuditFilters } from "@/lib/audit/query";
import { auditActions, auditEntities, type AuditAction, type AuditEntity } from "@/lib/audit/record";
import { getCurrentSuperAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import "./auditoria.css";

type AuditPageProps = {
  searchParams?: Promise<AuditFilters>;
};

/** A dónde lleva cada registro, si lo auditado sigue existiendo. */
function entityHref(row: { entity: string; action: string; entityId: string | null; entityLabel: string | null }) {
  if (row.action === "DELETE") return null;
  if (row.entity === "RESERVATION" && row.entityLabel) return `/admin/reservas/${encodeURIComponent(row.entityLabel)}`;
  if (row.entity === "USER" && row.entityId) return `/admin/usuarios/${encodeURIComponent(row.entityId)}`;
  return null;
}

/** Sólo lectura y sólo para el super administrador: acá se ve quién hizo qué, no se edita nada. */
export default async function AuditPage({ searchParams }: AuditPageProps) {
  const sessionUser = await getCurrentSuperAdminOrRedirect();
  const filters = parseAuditFilters((await searchParams) ?? {});
  const where = auditWhere(filters);

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: AUDIT_PAGE_SIZE,
      skip: (filters.page - 1) * AUDIT_PAGE_SIZE
    }),
    prisma.auditLog.count({ where })
  ]);
  const pages = Math.max(Math.ceil(total / AUDIT_PAGE_SIZE), 1);
  const filtered = !!(filters.q || filters.entity || filters.action || filters.from || filters.to);

  return (
    <AdminShell role={sessionUser.role} title="Auditoría" eyebrow="Quién hizo qué">
      <form className="filter-bar" action="/admin/auditoria">
        <label>
          Buscar
          <input name="q" type="search" defaultValue={filters.q} placeholder="Persona, email, código de reserva o IP" />
        </label>
        <label>
          Sección
          <select name="entity" defaultValue={filters.entity}>
            <option value="">Todas</option>
            {auditEntities.map((entity) => <option key={entity} value={entity}>{auditEntityLabels[entity]}</option>)}
          </select>
        </label>
        <label>
          Acción
          <select name="action" defaultValue={filters.action}>
            <option value="">Todas</option>
            {auditActions.map((action) => <option key={action} value={action}>{auditActionLabels[action]}</option>)}
          </select>
        </label>
        <label>
          Desde
          <input name="from" type="date" defaultValue={filters.from} />
        </label>
        <label>
          Hasta
          <input name="to" type="date" defaultValue={filters.to} />
        </label>
        <button className="ghost-button" type="submit">Filtrar</button>
        {filtered ? <Link className="ghost-button" href="/admin/auditoria">Limpiar</Link> : null}
      </form>

      <p className="muted audit-count">
        {total === 0 ? "Sin registros" : `${total} ${total === 1 ? "registro" : "registros"}`}
        {pages > 1 ? ` · página ${filters.page} de ${pages}` : ""}
      </p>

      <div className="audit-scroll">
        <table className="data-table audit-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Quién</th>
              <th>Acción</th>
              <th>Sobre</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const lines = auditChangeLines(row.changes);
              const href = entityHref(row);
              const who = row.actorName || row.actorEmail;
              return (
                <tr key={row.id} data-alerta={row.action === "LOGIN_FAILED" || row.action === "DELETE" || undefined}>
                  <td className="audit-when">{formatAuditDate(row.createdAt)}</td>
                  <td>
                    <strong>{who ?? auditRoleLabel(row.actorRole)}</strong>
                    {who ? <span className="audit-sub">{auditRoleLabel(row.actorRole)}</span> : null}
                    {row.actorName && row.actorEmail ? <span className="audit-sub">{row.actorEmail}</span> : null}
                  </td>
                  <td>
                    <span className="audit-action">{auditActionLabels[row.action as AuditAction] ?? row.action}</span>
                    <span className="audit-sub">{auditEntityLabels[row.entity as AuditEntity] ?? row.entity}</span>
                  </td>
                  <td>{href && row.entityLabel ? <Link href={href}>{row.entityLabel}</Link> : row.entityLabel ?? "—"}</td>
                  <td>
                    {row.summary}
                    {lines.length > 0 ? (
                      <ul className="audit-changes">
                        {lines.map((line) => (
                          <li key={line.field}>
                            <span className="audit-field">{line.label}:</span>{" "}
                            <span className="audit-before">{line.before}</span>{" → "}
                            <span className="audit-after">{line.after}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {row.ip ? <span className="audit-sub">IP {row.ip}{row.userAgent ? ` · ${row.userAgent}` : ""}</span> : null}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr><td colSpan={5}>{filtered ? "Ningún registro coincide con esos filtros." : "Todavía no hay registros de auditoría."}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <nav className="audit-pager" aria-label="Páginas">
          {filters.page > 1 ? <Link className="ghost-button" href={auditPageHref(filters, filters.page - 1)}>Más recientes</Link> : <span />}
          {filters.page < pages ? <Link className="ghost-button" href={auditPageHref(filters, filters.page + 1)}>Más antiguos</Link> : <span />}
        </nav>
      ) : null}
    </AdminShell>
  );
}
