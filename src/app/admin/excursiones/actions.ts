"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { errorState, successState, type AdminFormState } from "@/app/admin/form-state";
import { addExcursionPhoto, deleteExcursionRecord, getAdminExcursion, makeExcursionCoverRecord, removeExcursionPhotoRecord, saveExcursionRecord } from "@/lib/excursions/repository";
import { deleteExcursionBlobs, storeExcursionPhoto } from "@/lib/excursions/storage";
import { ExcursionError, MAX_EXCURSION_PHOTOS } from "@/lib/excursions/validation";
import { readForAudit, recordEntityAuditAfterCommit, type EntityAudit } from "@/lib/audit/entity";
import { prisma } from "@/lib/db/prisma";

const excursionRow = (id: string) => readForAudit(() => prisma.excursion.findUnique({ where: { id } }));

/** La excursión se guarda en su repositorio; la auditoría va después, sin poder romper lo guardado. */
function audit(entry: Omit<EntityAudit, "entity">) {
  return recordEntityAuditAfterCommit(prisma, { entity: "EXCURSION", ...entry });
}

function refresh(id: string) {
  revalidatePath("/admin/excursiones");
  revalidatePath(`/admin/excursiones/${id}`);
  for (const prefix of ["", "/en", "/pt"]) {
    revalidatePath(`${prefix}/excursiones`);
    revalidatePath(`${prefix}/excursiones/${id}`);
  }
}
function errorMessage(error: unknown) {
  return error instanceof ExcursionError ? error.message : "No pudimos guardar. Intentá nuevamente.";
}
export async function saveExcursion(id: string | null, version: string | null, _state: AdminFormState, form: FormData): Promise<AdminFormState> {
  const actor = await getCurrentReservationsUserOrRedirect();
  const before = id ? await excursionRow(id) : null;
  let saved;
  try { saved = await saveExcursionRecord(id, version, form); }
  catch (error) { return errorState(errorMessage(error)); }
  const after = await excursionRow(saved.id);
  if (after) await audit({ actor, entityId: saved.id, entityLabel: after.name, summary: id ? "Excursión editada." : "Excursión creada.", before, after });
  refresh(saved.id);
  redirect(`/admin/excursiones/${saved.id}?notice=Excursi%C3%B3n%20guardada`);
}
export async function uploadExcursionPhoto(id: string, _state: AdminFormState, form: FormData): Promise<AdminFormState> {
  const actor = await getCurrentReservationsUserOrRedirect();
  let uploaded: Awaited<ReturnType<typeof storeExcursionPhoto>> | undefined;
  try {
    const current = await getAdminExcursion(id);
    if (!current) throw new ExcursionError("La excursión ya no existe.");
    if (current.photos.length >= MAX_EXCURSION_PHOTOS) throw new ExcursionError("Podés cargar hasta 12 fotos por excursión.");
    const file = form.get("photo");
    if (!(file instanceof File)) throw new ExcursionError("Elegí una foto.");
    uploaded = await storeExcursionPhoto(id, file);
    await addExcursionPhoto(id, uploaded);
    await audit({ actor, entityId: id, entityLabel: current.name, action: "UPDATE", summary: "Foto agregada a la excursión.", extra: { photos: { before: current.photos.length, after: current.photos.length + 1 } } });
  } catch (error) {
    if (uploaded) await deleteExcursionBlobs([uploaded.blobPathname]);
    return errorState(errorMessage(error));
  }
  refresh(id);
  return successState("Foto subida. La primera foto es la principal; podés cambiarla en la galería.");
}
export async function removeExcursionPhoto(id: string, photoId: string, _form: FormData): Promise<void> {
  const actor = await getCurrentReservationsUserOrRedirect();
  let notice = "Foto eliminada. Si era la última, la excursión volvió a borrador.";
  const before = await excursionRow(id);
  try {
    const blob = await removeExcursionPhotoRecord(id, photoId);
    // Quitar la última foto despublica la excursión: ese cambio queda en el registro.
    await audit({ actor, entityId: id, entityLabel: before?.name, action: "UPDATE", summary: "Foto quitada de la excursión.", extra: { isPublished: { before: before?.isPublished ?? null, after: (await excursionRow(id))?.isPublished ?? null } } });
    await deleteExcursionBlobs([blob]);
  }
  catch (error) { notice = errorMessage(error); }
  refresh(id);
  redirect(`/admin/excursiones/${id}?notice=${encodeURIComponent(notice)}`);
}
export async function makeExcursionCover(id: string, photoId: string, _form: FormData): Promise<void> {
  const actor = await getCurrentReservationsUserOrRedirect();
  let notice = "Foto principal actualizada.";
  try {
    await makeExcursionCoverRecord(id, photoId);
    await audit({ actor, entityId: id, entityLabel: (await excursionRow(id))?.name, action: "UPDATE", summary: "Foto principal de la excursión cambiada." });
  }
  catch (error) { notice = errorMessage(error); }
  refresh(id);
  redirect(`/admin/excursiones/${id}?notice=${encodeURIComponent(notice)}`);
}
export async function deleteExcursion(id: string, form: FormData): Promise<void> {
  const actor = await getCurrentReservationsUserOrRedirect();
  if (form.get("confirm") !== "ELIMINAR") redirect(`/admin/excursiones/${id}?notice=Confirm%C3%A1%20la%20eliminaci%C3%B3n`);
  let failure: string | undefined;
  const before = await excursionRow(id);
  try {
    const blobs = await deleteExcursionRecord(id);
    if (before) await audit({ actor, entityId: id, entityLabel: before.name, summary: "Excursión eliminada.", before });
    await deleteExcursionBlobs(blobs);
  }
  catch (error) { failure = errorMessage(error); }
  refresh(id);
  if (failure) redirect(`/admin/excursiones/${id}?notice=${encodeURIComponent(failure)}`);
  redirect("/admin/excursiones?notice=Excursi%C3%B3n%20eliminada");
}
