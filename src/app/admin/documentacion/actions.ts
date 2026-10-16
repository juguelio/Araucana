"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { DOCUMENT_KINDS, type DocumentSubject } from "@/lib/compliance/catalog";
import { prisma } from "@/lib/db/prisma";
import { errorState, type AdminFieldErrors, type AdminFormState } from "../form-state";

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

const SUBJECTS: DocumentSubject[] = ["VEHICLE", "DRIVER"];

export async function createDocumentAction(
  _prevState: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  await getCurrentAdminOrRedirect();

  const subject = value(formData, "subject") as DocumentSubject;
  const vehicleId = value(formData, "vehicleId");
  const userId = value(formData, "userId");
  const kind = value(formData, "kind");
  const number = value(formData, "number") || null;
  const issuedAt = value(formData, "issuedAt");
  const expiresAt = value(formData, "expiresAt");
  const critical = formData.get("critical") === "on";
  const notes = value(formData, "notes") || null;

  const fieldErrors: AdminFieldErrors = {};
  if (!SUBJECTS.includes(subject)) fieldErrors.subject = "Elegí si el documento es de una nave o de un chofer.";
  if (subject === "VEHICLE" && !vehicleId) fieldErrors.vehicleId = "Elegí la nave.";
  if (subject === "DRIVER" && !userId) fieldErrors.userId = "Elegí el chofer.";
  if (!kind) fieldErrors.kind = "Elegí el tipo de documento.";
  if (subject && kind && SUBJECTS.includes(subject) && !DOCUMENT_KINDS[subject].some((k) => k.code === kind)) {
    fieldErrors.kind = "Ese tipo de documento no corresponde a la nave o al chofer elegido.";
  }
  if (!expiresAt) fieldErrors.expiresAt = "Ingresá la fecha de vencimiento.";

  if (Object.keys(fieldErrors).length > 0) {
    return errorState("Revisá los datos del documento.", fieldErrors);
  }

  const base = {
    kind,
    number,
    issuedAt: issuedAt ? new Date(`${issuedAt}T12:00:00.000Z`) : null,
    expiresAt: new Date(`${expiresAt}T12:00:00.000Z`),
    critical,
    notes
  };

  if (subject === "VEHICLE") {
    await prisma.vehicleDocument.create({ data: { ...base, vehicleId } });
  } else {
    await prisma.driverDocument.create({ data: { ...base, userId } });
  }

  revalidatePath("/admin/documentacion");
  redirect(`/admin/documentacion?notice=${encodeURIComponent("Documento cargado.")}`);
}

export async function deleteDocumentAction(formData: FormData) {
  await getCurrentAdminOrRedirect();

  const id = value(formData, "id");
  const subject = value(formData, "subject") as DocumentSubject;

  if (subject === "VEHICLE") {
    await prisma.vehicleDocument.delete({ where: { id } });
  } else if (subject === "DRIVER") {
    await prisma.driverDocument.delete({ where: { id } });
  }

  revalidatePath("/admin/documentacion");
  redirect(`/admin/documentacion?notice=${encodeURIComponent("Documento borrado.")}`);
}
