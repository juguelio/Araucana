export const receiptUploadConfig = {
  maxSizeBytes: 10 * 1024 * 1024,
  allowedContentTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
} as const;

export const receiptAccept = `${receiptUploadConfig.allowedContentTypes.join(",")},.heic,.heif`;
export const receiptFormatsHelp = "PDF, JPG, PNG, WEBP o foto de iPhone (HEIC/HEIF).";

/** Algunos selectores de archivos entregan HEIC sin MIME o como octet-stream. */
export function isHeicReceipt(file: Pick<File, "type" | "name">) {
  return ["image/heic", "image/heif"].includes(file.type)
    || ((!file.type || file.type === "application/octet-stream") && /\.hei[cf]$/i.test(file.name));
}

export function validateReceiptFile(file: File) {
  if (file.size <= 0) {
    return "Subi un comprobante valido.";
  }

  if (file.size > receiptUploadConfig.maxSizeBytes) {
    return "El comprobante no puede superar 10 MB.";
  }

  if (!isHeicReceipt(file) && !receiptUploadConfig.allowedContentTypes.includes(file.type as (typeof receiptUploadConfig.allowedContentTypes)[number])) {
    return "Elegí un comprobante en PDF, JPG, PNG, WEBP o HEIC/HEIF de iPhone.";
  }

  return null;
}

function hasHeifHeader(bytes: Uint8Array) {
  const word = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  if (bytes.length < 16 || word(4) !== "ftyp") return false;
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (boxSize < 16 || boxSize > bytes.length || boxSize % 4 !== 0) return false;
  const brands = [word(8)];
  for (let offset = 16; offset < boxSize; offset += 4) brands.push(word(offset));
  // AVIF también usa el contenedor HEIF, pero no es una foto HEIC.
  return !brands.some((brand) => ["avif", "avis"].includes(brand))
    && brands.some((brand) => ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand));
}

// Server-side header check: never trust the multipart MIME declaration alone.
export async function validateReceiptContent(file: File) {
  const error = validateReceiptFile(file);
  if (error) return error;
  const bytes = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  const matches = (values: number[], offset = 0) => values.every((value, index) => bytes[offset + index] === value);
  const valid = isHeicReceipt(file) ? hasHeifHeader(bytes)
    : file.type === "application/pdf" ? matches([0x25, 0x50, 0x44, 0x46, 0x2d])
    : file.type === "image/jpeg" ? matches([0xff, 0xd8, 0xff])
    : file.type === "image/png" ? matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : file.type === "image/webp" && matches([0x52, 0x49, 0x46, 0x46]) && matches([0x57, 0x45, 0x42, 0x50], 8);
  return valid ? null : "El contenido del archivo no coincide con el tipo de comprobante.";
}
