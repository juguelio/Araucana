/**
 * Catálogo de documentación y evaluación de vencimientos.
 *
 * Este módulo es **puro**: no importa Prisma ni nada del servidor, para que lo puedan usar
 * también componentes cliente (formularios del panel). Las funciones que tocan la base viven en
 * `./documents`.
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
 * Separa los documentos vencidos de los que están por vencer.
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
