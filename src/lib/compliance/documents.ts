import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";

/**
 * Documentación obligatoria de naves y choferes.
 *
 * Objetivo del negocio: que una nave o un chofer con papeles vencidos **no pueda** salir.
 * El aviso ayuda; el bloqueo es lo que evita el problema. Los tipos de documento son una lista
 * en código a propósito: la regla cambió en 2025 (se eliminó la LiNTI y las licencias
 * profesionales pasaron a las provincias), así que una tabla fija de "tipos" nace obsoleta.
 */

export type DocumentSubject = "VEHICLE" | "DRIVER";

export type DocumentKind = {
  code: string;
  label: string;
  /** Si está vencido, el sujeto no puede operar. */
  critical: boolean;
};

export const DOCUMENT_KINDS: Record<DocumentSubject, DocumentKind[]> = {
  VEHICLE: [
    { code: "VTV", label: "VTV (Verificación Técnica Vehicular)", critical: true },
    { code: "SEGURO", label: "Seguro / póliza", critical: true },
    { code: "HABILITACION", label: "Habilitación de transporte", critical: true },
    { code: "CNRT", label: "Inscripción CNRT / RNPA", critical: false },
    { code: "MATAfuegos", label: "Revisión de matafuegos y kit", critical: false }
  ],
  DRIVER: [
    { code: "LICENCIA", label: "Licencia de conducir", critical: true },
    { code: "APTO_MEDICO", label: "Apto psicofísico", critical: true },
    { code: "CURSO", label: "Curso de capacitación (ANSV)", critical: false },
    { code: "ART", label: "ART", critical: false },
    { code: "ANTECEDENTES", label: "Antecedentes penales", critical: false }
  ]
};

export function kindLabel(subject: DocumentSubject, code: string): string {
  return DOCUMENT_KINDS[subject].find((k) => k.code === code)?.label ?? code;
}

export type DocumentLike = {
  id: string;
  kind: string;
  expiresAt: Date;
  critical: boolean;
};

export type DocumentStatus = {
  expired: DocumentLike[];
  expiring: DocumentLike[];
};

/**
 * Parte pura y testeable: separa los documentos vencidos de los que están por vencer.
 * `expiring` = vence dentro de `withinDays` y todavía no venció.
 */
export function evaluateDocumentStatus(
  documents: DocumentLike[],
  now: Date = new Date(),
  withinDays = 30
): DocumentStatus {
  const limite = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
  const expired: DocumentLike[] = [];
  const expiring: DocumentLike[] = [];

  for (const doc of documents) {
    if (doc.expiresAt.getTime() < now.getTime()) expired.push(doc);
    else if (doc.expiresAt.getTime() <= limite.getTime()) expiring.push(doc);
  }

  expired.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  expiring.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  return { expired, expiring };
}

/** Documentos críticos vencidos de una nave (los que impiden que salga). */
export async function expiredCriticalVehicleDocuments(vehicleId: string, now: Date = new Date()) {
  const docs = await prisma.vehicleDocument.findMany({
    where: { vehicleId, critical: true, expiresAt: { lt: now } },
    orderBy: { expiresAt: "asc" }
  });
  return docs;
}

/** Documentos críticos vencidos de un chofer (los que impiden que maneje). */
export async function expiredCriticalDriverDocuments(userId: string, now: Date = new Date()) {
  const docs = await prisma.driverDocument.findMany({
    where: { userId, critical: true, expiresAt: { lt: now } },
    orderBy: { expiresAt: "asc" }
  });
  return docs;
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
