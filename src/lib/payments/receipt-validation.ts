export const receiptUploadConfig = {
  maxSizeBytes: 10 * 1024 * 1024,
  allowedContentTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"]
} as const;

export function validateReceiptFile(file: File) {
  if (file.size <= 0) {
    return "Subi un comprobante valido.";
  }

  if (file.size > receiptUploadConfig.maxSizeBytes) {
    return "El comprobante no puede superar 10 MB.";
  }

  if (!receiptUploadConfig.allowedContentTypes.includes(file.type as (typeof receiptUploadConfig.allowedContentTypes)[number])) {
    return "El comprobante debe ser PDF, JPG, PNG o WebP.";
  }

  return null;
}

// Server-side header check: never trust the multipart MIME declaration alone.
export async function validateReceiptContent(file: File) {
  const error = validateReceiptFile(file);
  if (error) return error;
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const matches = (values: number[], offset = 0) => values.every((value, index) => bytes[offset + index] === value);
  const valid = file.type === "application/pdf" ? matches([0x25, 0x50, 0x44, 0x46, 0x2d])
    : file.type === "image/jpeg" ? matches([0xff, 0xd8, 0xff])
    : file.type === "image/png" ? matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : file.type === "image/webp" && matches([0x52, 0x49, 0x46, 0x46]) && matches([0x57, 0x45, 0x42, 0x50], 8);
  return valid ? null : "El contenido del archivo no coincide con el tipo de comprobante.";
}
