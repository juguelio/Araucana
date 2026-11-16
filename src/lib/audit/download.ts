import { prisma } from "@/lib/db/prisma";
import { recordAuditBestEffort, requestOrigin, type AuditActor, type AuditEntity } from "./record";

/**
 * Deja constancia de que alguien se llevó datos del sistema: una planilla, el Excel contable, un
 * comprobante. No cambia nada, pero es lo que permite saber quién vio o descargó qué. Nunca frena
 * la descarga si la auditoría falla.
 */
export async function recordDownload(
  request: Request,
  actor: AuditActor,
  download: { entity: AuditEntity; entityId?: string | null; entityLabel?: string | null; summary: string; view?: boolean }
) {
  await recordAuditBestEffort(prisma, {
    actor,
    action: download.view ? "VIEW" : "EXPORT",
    entity: download.entity,
    entityId: download.entityId,
    entityLabel: download.entityLabel,
    summary: download.summary,
    ...requestOrigin(request)
  });
}
