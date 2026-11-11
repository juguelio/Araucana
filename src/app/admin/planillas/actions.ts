"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import {
  createDepartureSheet,
  removeDepartureSheetPassenger,
  setDepartureSheetOpen
} from "@/lib/departure-sheets/repository";
import { createDepartureSheetSchema } from "@/lib/departure-sheets/validation";

const base = "/admin/planillas";

function value(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

/** Abre una planilla nueva y lleva al detalle, que es donde está el link para compartir. */
export async function createDepartureSheetAction(form: FormData) {
  const user = await getCurrentReservationsUserOrRedirect();

  const parsed = createDepartureSheetSchema.safeParse({
    kind: value(form, "kind"),
    title: value(form, "title"),
    destination: value(form, "destination"),
    departureAt: value(form, "departureAt"),
    borderCrossing: value(form, "borderCrossing"),
    notes: value(form, "notes")
  });

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Revisá los datos.";
    redirect(`${base}?error=${encodeURIComponent(message)}`);
  }

  const sheet = await createDepartureSheet(parsed.data, user.id);
  revalidatePath(base);
  redirect(`${base}/${sheet.id}?alta=1`);
}

export async function setDepartureSheetOpenAction(form: FormData) {
  await getCurrentReservationsUserOrRedirect();

  const id = value(form, "id");
  if (!id) {
    redirect(`${base}?error=${encodeURIComponent("No encontramos la planilla.")}`);
  }

  await setDepartureSheetOpen(id, value(form, "isOpen") === "1");
  revalidatePath(base);
  revalidatePath(`${base}/${id}`);
  redirect(`${base}/${id}`);
}

export async function removeDepartureSheetPassengerAction(form: FormData) {
  await getCurrentReservationsUserOrRedirect();

  const passengerId = value(form, "passengerId");
  const sheetId = value(form, "sheetId");
  if (!passengerId || !sheetId) {
    redirect(`${base}?error=${encodeURIComponent("No encontramos el pasajero.")}`);
  }

  await removeDepartureSheetPassenger(passengerId);
  revalidatePath(`${base}/${sheetId}`);
  redirect(`${base}/${sheetId}?borrado=1`);
}
