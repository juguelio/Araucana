"use server";

import { revalidatePath } from "next/cache";
import { DepartureSheetError, getDepartureSheetByToken, submitDepartureSheetPassenger } from "@/lib/departure-sheets/repository";
import { departurePassengerSchema } from "@/lib/departure-sheets/validation";
import { isDepartureSheetKind, passengerFullName, type DepartureSheetKind } from "@/lib/departure-sheets/types";
import type { SubmitDeparturePassengerState } from "./state";

/**
 * Alta desde el link público. El tipo de planilla y el estado del link se leen de la base, nunca del
 * formulario: un hidden con `kind` o `isOpen` se puede cambiar desde el navegador.
 */
export async function submitDeparturePassengerAction(
  _previous: SubmitDeparturePassengerState,
  form: FormData
): Promise<SubmitDeparturePassengerState> {
  const token = String(form.get("token") ?? "").trim();
  const sheet = await getDepartureSheetByToken(token);

  if (!sheet) {
    return { status: "error", message: "No encontramos esta planilla. Pedile el link a la agencia." };
  }

  if (!sheet.isOpen) {
    return {
      status: "error",
      message: "La planilla ya no recibe datos. Si necesitás corregir algo, escribile a la agencia."
    };
  }

  const kind: DepartureSheetKind = isDepartureSheetKind(sheet.kind) ? sheet.kind : "DUT";
  const parsed = departurePassengerSchema(kind).safeParse({
    firstName: String(form.get("firstName") ?? ""),
    lastName: String(form.get("lastName") ?? ""),
    documentType: String(form.get("documentType") ?? ""),
    documentNumber: String(form.get("documentNumber") ?? ""),
    sex: String(form.get("sex") ?? ""),
    birthDate: String(form.get("birthDate") ?? ""),
    nationality: String(form.get("nationality") ?? ""),
    occupation: String(form.get("occupation") ?? ""),
    residenceCountry: String(form.get("residenceCountry") ?? "")
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Revisá los datos e intentá de nuevo."
    };
  }

  try {
    const result = await submitDepartureSheetPassenger(token, parsed.data);
    revalidatePath(`/admin/planillas/${sheet.id}`);
    revalidatePath("/admin/planillas");

    return {
      status: "ok",
      message: result.updated
        ? "Actualizamos los datos de este documento: no quedó duplicado en la planilla."
        : "Tus datos quedaron cargados en la planilla.",
      passengerName: passengerFullName(result.passenger),
      updated: result.updated
    };
  } catch (error) {
    if (error instanceof DepartureSheetError) {
      return { status: "error", message: error.message };
    }
    throw error;
  }
}
