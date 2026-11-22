"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { recordAuditBestEffort } from "@/lib/audit/record";
import { isValidPassword } from "@/lib/auth/password";
import { changeAccountPassword, getAppUserFromToken } from "@/lib/auth/service";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export type ProfileFormState = { error?: string; message?: string };

export async function updateProfileAction(_state: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  const user = await getAppUserFromToken();
  if (!user) redirect("/login");

  const name = form.get("name");
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120) {
    return { error: "Ingresá un nombre de hasta 120 caracteres." };
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { name: name.trim() },
    select: { name: true }
  });
  await recordAuditBestEffort(prisma, {
    actor: user, action: "UPDATE", entity: "USER", entityId: user.id, entityLabel: updated.name ?? user.email,
    summary: "La cuenta actualizó su nombre desde el perfil."
  });
  refresh();
  return { message: "Nombre actualizado." };
}

export async function changePasswordAction(_state: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = token ? await getAppUserFromToken(token) : null;
  if (!user || !token) redirect("/login");

  const currentPassword = form.get("currentPassword");
  const newPassword = form.get("newPassword");
  if (typeof newPassword !== "string" || !isValidPassword(newPassword)) {
    return { error: "Usá al menos 12 caracteres y hasta 72 bytes para la contraseña nueva." };
  }
  if (newPassword !== form.get("confirmation")) {
    return { error: "Las contraseñas nuevas no coinciden." };
  }
  if (typeof currentPassword !== "string" || !currentPassword || Buffer.byteLength(currentPassword) > 72 ||
    !(await changeAccountPassword(user.id, token, currentPassword, newPassword))) {
    return { error: "No se pudo verificar la contraseña actual." };
  }

  await recordAuditBestEffort(prisma, {
    actor: user, action: "UPDATE", entity: "USER", entityId: user.id, entityLabel: user.email,
    summary: "La cuenta cambió su contraseña desde el perfil."
  });
  return { message: "Contraseña actualizada. Se cerraron las demás sesiones." };
}
