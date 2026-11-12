"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { errorState, successState, type AdminFormState } from "@/app/admin/form-state";
import { addExcursionPhoto, deleteExcursionRecord, getAdminExcursion, makeExcursionCoverRecord, removeExcursionPhotoRecord, saveExcursionRecord } from "@/lib/excursions/repository";
import { deleteExcursionBlobs, storeExcursionPhoto } from "@/lib/excursions/storage";
import { ExcursionError, MAX_EXCURSION_PHOTOS } from "@/lib/excursions/validation";

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
  await getCurrentReservationsUserOrRedirect();
  let saved;
  try { saved = await saveExcursionRecord(id, version, form); }
  catch (error) { return errorState(errorMessage(error)); }
  refresh(saved.id);
  redirect(`/admin/excursiones/${saved.id}?notice=Excursi%C3%B3n%20guardada`);
}
export async function uploadExcursionPhoto(id: string, _state: AdminFormState, form: FormData): Promise<AdminFormState> {
  await getCurrentReservationsUserOrRedirect();
  let uploaded: Awaited<ReturnType<typeof storeExcursionPhoto>> | undefined;
  try {
    const current = await getAdminExcursion(id);
    if (!current) throw new ExcursionError("La excursión ya no existe.");
    if (current.photos.length >= MAX_EXCURSION_PHOTOS) throw new ExcursionError("Podés cargar hasta 12 fotos por excursión.");
    const file = form.get("photo");
    if (!(file instanceof File)) throw new ExcursionError("Elegí una foto.");
    uploaded = await storeExcursionPhoto(id, file);
    await addExcursionPhoto(id, uploaded);
  } catch (error) {
    if (uploaded) await deleteExcursionBlobs([uploaded.blobPathname]);
    return errorState(errorMessage(error));
  }
  refresh(id);
  return successState("Foto subida. La primera foto es la principal; podés cambiarla en la galería.");
}
export async function removeExcursionPhoto(id: string, photoId: string, _form: FormData): Promise<void> {
  await getCurrentReservationsUserOrRedirect();
  let notice = "Foto eliminada. Si era la última, la excursión volvió a borrador.";
  try { await deleteExcursionBlobs([await removeExcursionPhotoRecord(id, photoId)]); }
  catch (error) { notice = errorMessage(error); }
  refresh(id);
  redirect(`/admin/excursiones/${id}?notice=${encodeURIComponent(notice)}`);
}
export async function makeExcursionCover(id: string, photoId: string, _form: FormData): Promise<void> {
  await getCurrentReservationsUserOrRedirect();
  let notice = "Foto principal actualizada.";
  try { await makeExcursionCoverRecord(id, photoId); }
  catch (error) { notice = errorMessage(error); }
  refresh(id);
  redirect(`/admin/excursiones/${id}?notice=${encodeURIComponent(notice)}`);
}
export async function deleteExcursion(id: string, form: FormData): Promise<void> {
  await getCurrentReservationsUserOrRedirect();
  if (form.get("confirm") !== "ELIMINAR") redirect(`/admin/excursiones/${id}?notice=Confirm%C3%A1%20la%20eliminaci%C3%B3n`);
  let failure: string | undefined;
  try { await deleteExcursionBlobs(await deleteExcursionRecord(id)); }
  catch (error) { failure = errorMessage(error); }
  refresh(id);
  if (failure) redirect(`/admin/excursiones/${id}?notice=${encodeURIComponent(failure)}`);
  redirect("/admin/excursiones?notice=Excursi%C3%B3n%20eliminada");
}
