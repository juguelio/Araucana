import { ApiError } from "@/lib/api/responses";
import {
  DOCUMENT_KINDS,
  evaluateDocumentStatus,
  kindLabel,
  type DocumentSubject
} from "@/lib/compliance/catalog";
import { prisma } from "@/lib/db/prisma";

/**
 * Parte que toca la base: consultas y **bloqueo** de naves/choferes con papeles vencidos.
 *
 * Objetivo del negocio: que una nave o un chofer con documentación vencida **no pueda salir**.
 * El aviso ayuda; el bloqueo es lo que evita el problema. Los tipos de documento son una lista
 * en código a propósito: la regla cambió en 2025 (se eliminó la LiNTI y las licencias
 * profesionales pasaron a las provincias), así que una tabla fija de "tipos" nace obsoleta.
 *
 * El catálogo y las funciones puras viven en `./catalog`, porque los usa también el formulario
 * del panel (componente cliente) y este archivo importa Prisma, que es sólo del servidor.
 */

export { DOCUMENT_KINDS, evaluateDocumentStatus, kindLabel };
export type { DocumentSubject };

/** Documentos críticos vencidos de una nave (los que impiden que salga). */
export async function expiredCriticalVehicleDocuments(vehicleId: string, now: Date = new Date()) {
  return prisma.vehicleDocument.findMany({
    where: { vehicleId, critical: true, expiresAt: { lt: now } },
    orderBy: { expiresAt: "asc" }
  });
}

/** Documentos críticos vencidos de un chofer (los que impiden que maneje). */
export async function expiredCriticalDriverDocuments(userId: string, now: Date = new Date()) {
  return prisma.driverDocument.findMany({
    where: { userId, critical: true, expiresAt: { lt: now } },
    orderBy: { expiresAt: "asc" }
  });
}

function describe(docs: Array<{ kind: string; expiresAt: Date }>, subject: DocumentSubject) {
  return docs
    .map((d) => `${kindLabel(subject, d.kind)} (venció ${d.expiresAt.toISOString().slice(0, 10)})`)
    .join(", ");
}

/**
 * Corta la operación si la nave tiene documentación crítica vencida.
 * Se usa en el alta de salidas: sin esto, "avisar" no alcanza.
 */
export async function assertVehicleDocumented(vehicleId: string, now: Date = new Date()) {
  const vencidos = await expiredCriticalVehicleDocuments(vehicleId, now);
  if (vencidos.length > 0) {
    throw new ApiError(
      "VEHICLE_DOCUMENT_EXPIRED",
      `La nave no puede salir: ${describe(vencidos, "VEHICLE")}.`,
      409
    );
  }
}

/** Corta la asignación si el chofer tiene licencia/apto vencido. */
export async function assertDriverDocumented(userId: string, now: Date = new Date()) {
  const vencidos = await expiredCriticalDriverDocuments(userId, now);
  if (vencidos.length > 0) {
    throw new ApiError(
      "DRIVER_DOCUMENT_EXPIRED",
      `El chofer no puede manejar: ${describe(vencidos, "DRIVER")}.`,
      409
    );
  }
}

/** Para el tablero: todo lo vencido y lo que vence dentro de `withinDays`, de naves y choferes. */
export async function complianceOverview(now: Date = new Date(), withinDays = 30) {
  const limite = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

  const [vehicleDocs, driverDocs] = await Promise.all([
    prisma.vehicleDocument.findMany({
      where: { expiresAt: { lte: limite } },
      include: { vehicle: { select: { id: true, name: true, licensePlate: true } } },
      orderBy: { expiresAt: "asc" }
    }),
    prisma.driverDocument.findMany({
      where: { expiresAt: { lte: limite } },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { expiresAt: "asc" }
    })
  ]);

  return {
    withinDays,
    vehicles: evaluateDocumentStatus(vehicleDocs, now, withinDays),
    drivers: evaluateDocumentStatus(driverDocs, now, withinDays),
    raw: { vehicleDocs, driverDocs }
  };
}
