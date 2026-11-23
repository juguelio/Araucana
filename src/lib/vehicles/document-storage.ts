import { put } from "@vercel/blob";
import { TIPO_DE_DOCUMENTO_LABEL, type TipoDeDocumento } from "./documents";

/**
 * Guarda el archivo del papel en Vercel Blob (privado: se sirve por la ruta autenticada
 * `/api/vehiculos/[id]/documentos/[documentId]`, igual que los comprobantes de pago).
 * La ruta incluye la unidad y el tipo para poder auditar el bucket a mano si hace falta.
 */

type DocumentoGuardado = {
  blobUrl: string;
  blobPathname: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

function extensionPara(contentType: string) {
  const extensiones: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };
  return extensiones[contentType] ?? "bin";
}

function nombreSeguro(fileName: string) {
  const sinExtension = fileName.replace(/\.[^.]+$/, "");
  const normalizado = sinExtension
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return normalizado || "documento";
}

export function almacenamientoDeDocumentosDisponible() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function guardarDocumentoDeNave(
  vehicleId: string,
  kind: TipoDeDocumento,
  file: File
): Promise<DocumentoGuardado> {
  const extension = extensionPara(file.type);
  const pathname = `vehicle-documents/${vehicleId}/${kind.toLowerCase()}/${Date.now()}-${nombreSeguro(file.name)}.${extension}`;
  const blob = await put(pathname, file, {
    access: "private",
    contentType: file.type,
    addRandomSuffix: true
  });

  return {
    blobUrl: blob.url,
    blobPathname: blob.pathname,
    // El nombre que se muestra es el del papel («Póliza de seguro.pdf»), no el original con el que
    // el operador lo bajó de WhatsApp.
    fileName: `${TIPO_DE_DOCUMENTO_LABEL[kind].replace(/[^\wáéíóúÁÉÍÓÚñÑ ]/g, "")}.${extension}`,
    contentType: blob.contentType || file.type,
    sizeBytes: file.size
  };
}
