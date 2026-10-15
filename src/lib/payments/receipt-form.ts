import { ApiError } from "@/lib/api/responses";

export const MAX_RECEIPT_REQUEST_BYTES = 12 * 1024 * 1024;

export async function readReceiptFormData(request: Request) {
  const tooLarge = () => new ApiError("PAYLOAD_TOO_LARGE", "El comprobante es demasiado grande.", 413);
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_RECEIPT_REQUEST_BYTES) throw tooLarge();
  if (!request.body) throw new ApiError("VALIDATION_ERROR", "Falta el comprobante.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RECEIPT_REQUEST_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    return await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    throw new ApiError("VALIDATION_ERROR", "El formulario de comprobante no es válido.", 400);
  }
}
