import { randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";
import { ExcursionError, validateExcursionPhoto } from "./validation";

export async function storeExcursionPhoto(id: string, file: File) {
  const error = await validateExcursionPhoto(file);
  if (error) throw new ExcursionError(error);
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
  const blob = await put(`excursion-photos/${id}/${randomUUID()}.${extension}`, file, { access: "private", contentType: file.type, addRandomSuffix: true });
  return { blobPathname: blob.pathname, contentType: file.type };
}

export async function deleteExcursionBlobs(pathnames: string[]) {
  const safe = pathnames.filter((path) => /^excursion-photos\/[^/]+\/[^/]+$/.test(path));
  if (!safe.length) return;
  try {
    await del(safe);
  } catch {
    // La baja editorial ya ocurrió. No exponer rutas privadas ni fallar el formulario.
    console.warn("No se pudieron limpiar fotos de excursiones en Blob; revisar almacenamiento.");
  }
}
