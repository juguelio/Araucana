"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, isValidPassword } from "@/lib/auth/password";
import { parseMonthlySalaryCents } from "@/lib/admin/salary";
import { getManagedUserPath, isManagedUserRole, type ManagedUserRole } from "@/lib/admin/users";
import { errorState, type AdminFormState } from "../form-state";

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function reportError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return errorState("Ese email ya está asociado a otra cuenta.");
  }
  return errorState(error instanceof Error ? error.message : "No pudimos guardar la cuenta.");
}

function notice(message: string): never {
  redirect(`${getManagedUserPath()}?notice=${encodeURIComponent(message)}`);
}

function refreshUsers() {
  revalidatePath("/admin");
  revalidatePath(getManagedUserPath());
  revalidatePath("/admin/secretarias");
  revalidatePath("/admin/choferes");
}

async function ensureAdminRemains(tx: Prisma.TransactionClient, userId: string, nextRole: ManagedUserRole, nextActive: boolean) {
  const target = await tx.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (!target || target.role !== "ADMIN" || (nextRole === "ADMIN" && nextActive)) return;
  const activeAdmins = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
  const activeAdminsAfterChange = activeAdmins - (target.isActive ? 1 : 0);
  if (activeAdminsAfterChange < 1) throw new Error("No se puede quitar o desactivar al último administrador activo.");
}

export async function updateManagedUserAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await getCurrentAdminOrRedirect();
  const id = value(formData, "id");
  const roleInput = value(formData, "role");
  const name = value(formData, "name");
  const passwordValue = formData.get("password");
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const isActive = value(formData, "isActive") === "true";

  if (!id || !isManagedUserRole(roleInput)) return errorState("Revisa los datos de la cuenta.");
  const role: ManagedUserRole = roleInput;
  if (id === actor.id && (role !== "ADMIN" || !isActive)) {
    return errorState("No podés quitarte el rol de administrador ni desactivar tu propia cuenta.");
  }

  let monthlySalaryCents: number | null = null;
  if (password && !isValidPassword(password)) return errorState("La contraseña debe tener al menos 12 caracteres y no superar 72 bytes UTF-8.");
  try {
    monthlySalaryCents = role === "SECRETARY" || role === "DRIVER"
      ? parseMonthlySalaryCents(value(formData, "monthlySalary"))
      : null;
    await prisma.$transaction(async (tx) => {
      await ensureAdminRemains(tx, id, role, isActive);
      await tx.user.update({
        where: { id },
        data: {
          name: name || null,
          role,
          isActive,
          monthlySalaryCents,
          salaryCurrency: "ARS",
          ...(password ? { passwordHash: await hashPassword(password) } : {})
        }
      });
      if (password) await tx.session.deleteMany({ where: { userId: id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    return reportError(error);
  }

  refreshUsers();
  notice("Cuenta actualizada.");
}

export async function setManagedUserActiveAction(formData: FormData) {
  const actor = await getCurrentAdminOrRedirect();
  const id = value(formData, "id");
  const isActive = value(formData, "isActive") === "true";
  if (actor.id === id && !isActive) notice("No podés desactivar tu propia cuenta.");
  try {
    await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
      if (!target) throw new Error("La cuenta ya no existe.");
      const role = isManagedUserRole(target.role) ? target.role : "USER";
      await ensureAdminRemains(tx, id, role, isActive);
      await tx.user.update({ where: { id }, data: { isActive } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    notice(error instanceof Error ? error.message : "No pudimos cambiar el estado.");
  }
  refreshUsers();
  notice(isActive ? "Cuenta activada." : "Cuenta desactivada.");
}

export async function deleteManagedUserAction(formData: FormData) {
  const actor = await getCurrentAdminOrRedirect();
  const id = value(formData, "id");
  if (!id || actor.id === id) notice("No podés eliminar tu propia cuenta.");

  try {
    await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
      if (!target) throw new Error("La cuenta ya no existe.");
      if (target.role === "ADMIN") {
        const activeAdmins = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
        const adminsAfterDelete = activeAdmins - (target.isActive ? 1 : 0);
        if (adminsAfterDelete < 1) throw new Error("No se puede eliminar al último administrador activo.");
      }
      await tx.user.delete({ where: { id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    notice(error instanceof Error ? error.message : "No pudimos eliminar la cuenta.");
  }

  refreshUsers();
  notice("Cuenta eliminada y acceso revocado.");
}
