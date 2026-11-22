import { ApiError } from "@/lib/api/responses";
import { isHeicReceipt, receiptUploadConfig, validateReceiptContent, validateReceiptFile } from "./receipt-validation";

/** Se guarda JPG para que tanto el pasajero como el admin puedan leerlo en cualquier navegador. */
export async function normalizeReceipt(file: File, maxSizeBytes: number = receiptUploadConfig.maxSizeBytes): Promise<File> {
  const fileError = validateReceiptFile(file);
  if (fileError) throw new ApiError("VALIDATION_ERROR", fileError, 400);
  const error = await validateReceiptContent(file);
  const heicError = "No pudimos leer la foto HEIC/HEIF. Volvé a elegirla o enviá el comprobante como JPG o PDF.";
  if (error) throw new ApiError("VALIDATION_ERROR", isHeicReceipt(file) ? heicError : error, 400);
  if (!isHeicReceipt(file)) {
    // Safari puede entregar una foto ya convertida a JPEG conservando el nombre HEIC.
    return file.type === "image/jpeg" && /\.hei[cf]$/i.test(file.name)
      ? new File([file], file.name.replace(/\.hei[cf]$/i, ".jpg"), { type: "image/jpeg" })
      : file;
  }

  let jpeg: File;
  try {
    // El decodificador sólo se carga cuando llega un HEIC; nunca forma parte del cliente.
    const { default: convert } = await import("heic-convert");
    const bytes = await convert({ buffer: new Uint8Array(await file.arrayBuffer()), format: "JPEG", quality: 0.9 });
    const name = file.name.replace(/\.[^.]+$/, "") || "comprobante";
    jpeg = new File([new Uint8Array(bytes)], `${name}.jpg`, { type: "image/jpeg" });
  } catch {
    throw new ApiError("VALIDATION_ERROR", heicError, 400);
  }
  if (jpeg.size > maxSizeBytes) {
    throw new ApiError("VALIDATION_ERROR", "La foto convertida es demasiado grande. Elegí una imagen más chica o enviá el comprobante como PDF.", 400);
  }
  const convertedError = await validateReceiptContent(jpeg);
  if (convertedError) throw new ApiError("VALIDATION_ERROR", "No pudimos convertir la foto. Enviá el comprobante como JPG o PDF.", 400);
  return jpeg;
}
