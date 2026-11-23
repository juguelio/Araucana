"use server";

import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { recordAudit } from "@/lib/audit/record";
import { prisma } from "@/lib/db/prisma";
import {
  TIPO_DE_DOCUMENTO_LABEL,
  errorDeDocumento,
  esTipoDeDocumento,
  fechaDeVencimientoDelPapel,
  firmaDeArchivoValida
} from "@/lib/vehicles/documents";
import { almacenamientoDeDocumentosDisponible, guardarDocumentoDeNave } from "@/lib/vehicles/document-storage";
import { errorState, successState, type AdminFormState } from "../../../form-state";
import { revalidarNaves } from "../../revalidate";

/**
 * Subir el papel de una unidad (póliza, técnica, RTO o cédula). Nunca se borra el anterior: la fila
 * nueva pasa a ser el vigente y la vieja queda en el historial de la ficha.
 */

function value(formData: FormData, key: string) {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

export async function uploadVehicleDocumentAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await getCurrentAdminOrRedirect();
  const vehicleId = value(formData, "vehicleId");
  const kind = value(formData, "kind");
  if (!vehicleId) return errorState("No se sabe de qué unidad es el papel.");
  if (!esTipoDeDocumento(kind)) return errorState("Elegí qué papel estás subiendo.");

  const archivo = formData.get("file");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return errorState("Elegí el archivo del papel.", { file: "Elegí el archivo del papel." });
  }

  const error = errorDeDocumento({ name: archivo.name, type: archivo.type, size: archivo.size });
  if (error) return errorState(error, { file: error });
  if (!(await firmaDeArchivoValida(archivo))) {
    return errorState("El contenido del archivo no es un PDF ni una imagen.", { file: "El contenido del archivo no coincide con un PDF o una foto." });
  }
  if (!almacenamientoDeDocumentosDisponible()) {
    return errorState("La carga de documentación no está disponible: falta configurar el almacenamiento. Avisá al equipo de Araucana.");
  }

  const vencimientoTexto = value(formData, "expiresAt");
  const expiresAt = vencimientoTexto ? fechaDeVencimientoDelPapel(vencimientoTexto) : null;
  if (vencimientoTexto && !expiresAt) {
    return errorState("Revisá la fecha de vencimiento del papel.", { expiresAt: "La fecha no es válida (dd/mm/aaaa)." });
  }

  const nave = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, name: true, internalNumber: true } });
  if (!nave) return errorState("La nave ya no existe.");

  try {
    const guardado = await guardarDocumentoDeNave(vehicleId, kind, archivo);
    await prisma.$transaction(async (tx) => {
      const documento = await tx.vehicleDocument.create({
        data: {
          vehicleId,
          kind,
          fileName: guardado.fileName,
          contentType: guardado.contentType,
          sizeBytes: guardado.sizeBytes,
          blobUrl: guardado.blobUrl,
          blobPathname: guardado.blobPathname,
          expiresAt,
          uploadedById: actor.id,
          uploadedByName: actor.name ?? actor.email ?? null
        }
      });
      await recordAudit(tx, {
        actor,
        action: "UPDATE",
        entity: "VEHICLE",
        entityId: vehicleId,
        entityLabel: nave.name,
        summary: `Documentación: ${TIPO_DE_DOCUMENTO_LABEL[kind].toLowerCase()} adjunta`,
        changes: {
          "documento.kind": { before: null, after: kind },
          "documento.fileName": { before: null, after: documento.fileName },
          // Una fecha vacía no es «cambió a null»: se dice sólo cuando el papel la declara.
          ...(expiresAt ? { "documento.expiresAt": { before: null, after: expiresAt.toISOString().slice(0, 10) } } : {})
        }
      });
    });
  } catch (errorGuardado) {
    return errorState(errorGuardado instanceof Error ? errorGuardado.message : "No pudimos guardar el papel. Probá de nuevo.");
  }

  revalidarNaves();
  return successState(`${TIPO_DE_DOCUMENTO_LABEL[kind]} subida. Queda como el papel vigente de la unidad.`);
}
