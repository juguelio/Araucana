"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import {
  DepartureSheetError,
  ensureDepartureSheet,
  removeDepartureSheetPassenger,
  setDepartureSheetOpen
} from "@/lib/departure-sheets/repository";
import { isDepartureSheetKind } from "@/lib/departure-sheets/types";

const viajes = "/admin/viajes-especiales";

function value(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

/**
 * Genera (o recupera) el link de la planilla de ese viaje especial. No hay alta de planillas
 * sueltas: la planilla es del viaje y el link se manda desde ahí a los pasajeros.
 */
export async function ensureDepartureSheetAction(form: FormData) {
  const user = await getCurrentReservationsUserOrRedirect();
  const tripId = value(form, "tripId");
  const kind = value(form, "kind");

  if (!tripId || !isDepartureSheetKind(kind)) {
    redirect(viajes);
  }

  let notice = "Link de la planilla listo para enviar a los pasajeros.";
  try {
    await ensureDepartureSheet(tripId, kind, user.id);
  } catch (error) {
    if (!(error instanceof DepartureSheetError)) {
      throw error;
    }
    notice = error.message;
  }

  revalidatePath(`${viajes}/${tripId}`);
  redirect(`${viajes}/${tripId}?planilla=${encodeURIComponent(notice)}#planillas`);
}

export async function setDepartureSheetOpenAction(form: FormData) {
  await getCurrentReservationsUserOrRedirect();

  const id = value(form, "id");
  const tripId = value(form, "tripId");
  if (!id || !tripId) {
    redirect(viajes);
  }

  await setDepartureSheetOpen(id, value(form, "isOpen") === "1");
  revalidatePath(`${viajes}/${tripId}`);
  revalidatePath(`/admin/planillas/${id}`);
  redirect(`${viajes}/${tripId}#planillas`);
}

export async function removeDepartureSheetPassengerAction(form: FormData) {
  await getCurrentReservationsUserOrRedirect();

  const passengerId = value(form, "passengerId");
  const sheetId = value(form, "sheetId");
  if (!passengerId || !sheetId) {
    redirect(viajes);
  }

  await removeDepartureSheetPassenger(passengerId);
  revalidatePath(`/admin/planillas/${sheetId}`);
  redirect(`/admin/planillas/${sheetId}`);
}
