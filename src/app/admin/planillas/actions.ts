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

const reservas = "/admin/reservas";

function value(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

/**
 * Genera (o recupera) el link de la planilla de esa reserva. No hay alta de planillas sueltas: la
 * planilla siempre es de un pasajero que ya tiene reserva, y el link se manda desde ahí.
 */
export async function ensureDepartureSheetAction(form: FormData) {
  const user = await getCurrentReservationsUserOrRedirect();
  const code = value(form, "code").toUpperCase();
  const kind = value(form, "kind");

  if (!code || !isDepartureSheetKind(kind)) {
    redirect(reservas);
  }

  let notice = "Link de la planilla listo para enviar al pasajero.";
  try {
    await ensureDepartureSheet(code, kind, user.id);
  } catch (error) {
    if (!(error instanceof DepartureSheetError)) {
      throw error;
    }
    notice = error.message;
  }

  revalidatePath(`${reservas}/${code}`);
  redirect(`${reservas}/${code}?notice=${encodeURIComponent(notice)}#planillas`);
}

export async function setDepartureSheetOpenAction(form: FormData) {
  await getCurrentReservationsUserOrRedirect();

  const id = value(form, "id");
  const code = value(form, "code").toUpperCase();
  if (!id || !code) {
    redirect(reservas);
  }

  await setDepartureSheetOpen(id, value(form, "isOpen") === "1");
  revalidatePath(`${reservas}/${code}`);
  revalidatePath(`/admin/planillas/${id}`);
  redirect(`${reservas}/${code}#planillas`);
}

export async function removeDepartureSheetPassengerAction(form: FormData) {
  await getCurrentReservationsUserOrRedirect();

  const passengerId = value(form, "passengerId");
  const sheetId = value(form, "sheetId");
  if (!passengerId || !sheetId) {
    redirect(reservas);
  }

  await removeDepartureSheetPassenger(passengerId);
  revalidatePath(`/admin/planillas/${sheetId}`);
  redirect(`/admin/planillas/${sheetId}`);
}
