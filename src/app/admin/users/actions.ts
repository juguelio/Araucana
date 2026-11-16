"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, isValidPassword } from "@/lib/auth/password";
import { parseMonthlySalaryCents } from "@/lib/admin/salary";
import { getManagedUserPath, isManagedUserRole, type ManagedUserRole } from "@/lib/admin/users";
import { validateManagedUserDraft } from "@/lib/admin/user-draft";
import { diffRecords, hasChanges, HIDDEN_VALUE } from "@/lib/audit/diff";
import { recordAudit } from "@/lib/audit/record";
import { isAdminRole, isSuperAdminRole } from "@/lib/auth/roles";
import { canAssignRole, canManageAccount, PROTECTED_ACCOUNT_MESSAGE, SUPERADMIN_ROLE_MESSAGE } from "@/lib/auth/super-admin";
import { errorState, type AdminFormState } from "../form-state";

/** Los datos de una cuenta que entran a la auditoría. La contraseña nunca: sólo que cambió. */
const auditedUserFields = { email: true, name: true, role: true, isActive: true, monthlySalaryCents: true } as const;

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

const adminRoles = ["ADMIN", "SUPERADMIN"];

/**
 * Nunca se queda el sistema sin quien lo administre: tiene que seguir habiendo un administrador
 * activo (el super administrador cuenta) y, si ya hay super administradores, uno activo — si no,
 * nadie podría volver a asignar ese rol ni ver la auditoría. `nextRole` en `null` es un borrado.
 */
async function ensureAdminRemains(tx: Prisma.TransactionClient, userId: string, nextRole: ManagedUserRole | null, nextActive: boolean) {
  const target = await tx.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (!target || !target.isActive) return;
  if (isAdminRole(target.role) && !(isAdminRole(nextRole) && nextActive)) {
    const activeAdmins = await tx.user.count({ where: { role: { in: adminRoles }, isActive: true } });
    if (activeAdmins - 1 < 1) throw new Error("No se puede quitar o desactivar al último administrador activo.");
  }
  if (isSuperAdminRole(target.role) && !(isSuperAdminRole(nextRole) && nextActive)) {
    const activeSuperAdmins = await tx.user.count({ where: { role: "SUPERADMIN", isActive: true } });
    if (activeSuperAdmins - 1 < 1) throw new Error("No se puede quitar o desactivar al último super administrador activo.");
  }
}

export async function createManagedUserAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await getCurrentAdminOrRedirect();
  const passwordValue = formData.get("password");

  const validated = validateManagedUserDraft({
    email: value(formData, "email"),
    name: value(formData, "name"),
    password: typeof passwordValue === "string" ? passwordValue : "",
    role: value(formData, "role"),
    isActive: value(formData, "isActive") !== "false",
    monthlySalary: value(formData, "monthlySalary")
  });

  if (!validated.ok) {
    return errorState("Revisá los datos de la cuenta.", validated.errors);
  }

  const { draft } = validated;
  if (!canAssignRole(actor, draft.role)) return errorState(SUPERADMIN_ROLE_MESSAGE, { role: SUPERADMIN_ROLE_MESSAGE });
  try {
    const passwordHash = await hashPassword(draft.password);
    await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: draft.email,
          name: draft.name,
          role: draft.role,
          isActive: draft.isActive,
          monthlySalaryCents: draft.monthlySalaryCents,
          salaryCurrency: "ARS",
          passwordHash
        },
        select: { id: true, ...auditedUserFields }
      });
      const { id, ...fields } = created;
      await recordAudit(tx, {
        actor, action: "CREATE", entity: "USER", entityId: id, entityLabel: created.email,
        summary: "Cuenta creada desde el panel.",
        changes: diffRecords(null, fields)
      });
    });
  } catch (error) {
    return reportError(error);
  }

  refreshUsers();
  notice(`Cuenta creada para ${draft.email}. Entregale la contraseña inicial y pedile que la cambie.`);
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
  if (!canAssignRole(actor, role)) return errorState(SUPERADMIN_ROLE_MESSAGE, { role: SUPERADMIN_ROLE_MESSAGE });
  if (id === actor.id && (!isAdminRole(role) || !isActive)) {
    return errorState("No podés quitarte el rol de administrador ni desactivar tu propia cuenta.");
  }

  let monthlySalaryCents: number | null = null;
  if (password && !isValidPassword(password)) return errorState("La contraseña debe tener al menos 12 caracteres y no superar 72 bytes UTF-8.");
  try {
    monthlySalaryCents = role === "SECRETARY" || role === "DRIVER"
      ? parseMonthlySalaryCents(value(formData, "monthlySalary"))
      : null;
    await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id }, select: auditedUserFields });
      if (!before) throw new Error("La cuenta ya no existe.");
      if (!canManageAccount(actor, before)) throw new Error(PROTECTED_ACCOUNT_MESSAGE);
      await ensureAdminRemains(tx, id, role, isActive);
      const after = await tx.user.update({
        where: { id },
        data: {
          name: name || null,
          role,
          isActive,
          monthlySalaryCents,
          salaryCurrency: "ARS",
          ...(password ? { passwordHash: await hashPassword(password) } : {})
        },
        select: auditedUserFields
      });
      if (password) await tx.session.deleteMany({ where: { userId: id } });
      const changes = {
        ...diffRecords(before, after),
        ...(password ? { password: { before: HIDDEN_VALUE, after: HIDDEN_VALUE } } : {})
      };
      if (hasChanges(changes)) {
        await recordAudit(tx, {
          actor, action: "UPDATE", entity: "USER", entityId: id, entityLabel: before.email,
          summary: password ? "Cuenta actualizada: se cambió la contraseña y se cerraron sus sesiones." : "Cuenta actualizada.",
          changes
        });
      }
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
      const target = await tx.user.findUnique({ where: { id }, select: { email: true, role: true, isActive: true } });
      if (!target) throw new Error("La cuenta ya no existe.");
      if (!canManageAccount(actor, target)) throw new Error(PROTECTED_ACCOUNT_MESSAGE);
      const role = isManagedUserRole(target.role) ? target.role : "USER";
      await ensureAdminRemains(tx, id, role, isActive);
      await tx.user.update({ where: { id }, data: { isActive } });
      const changes = diffRecords({ isActive: target.isActive }, { isActive });
      if (hasChanges(changes)) {
        await recordAudit(tx, {
          actor, action: "UPDATE", entity: "USER", entityId: id, entityLabel: target.email,
          summary: isActive ? "Cuenta activada." : "Cuenta desactivada.",
          changes
        });
      }
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
      const target = await tx.user.findUnique({ where: { id }, select: auditedUserFields });
      if (!target) throw new Error("La cuenta ya no existe.");
      if (!canManageAccount(actor, target)) throw new Error(PROTECTED_ACCOUNT_MESSAGE);
      await ensureAdminRemains(tx, id, null, false);
      await tx.user.delete({ where: { id } });
      await recordAudit(tx, {
        actor, action: "DELETE", entity: "USER", entityId: id, entityLabel: target.email,
        summary: "Cuenta eliminada y acceso revocado.",
        changes: diffRecords(target, null)
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    notice(error instanceof Error ? error.message : "No pudimos eliminar la cuenta.");
  }

  refreshUsers();
  notice("Cuenta eliminada y acceso revocado.");
}
