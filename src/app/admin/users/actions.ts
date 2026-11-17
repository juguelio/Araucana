"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { getCurrentAdminOrRedirect, getCurrentDriverManagerOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, isValidPassword } from "@/lib/auth/password";
import { parseMonthlySalaryCents } from "@/lib/admin/salary";
import { getManagedUserPath, isManagedUserRole, type ManagedUserRole } from "@/lib/admin/users";
import { canManageManagedUser, canSeeSalary, forcedManagedRole, managedUsersBasePath } from "@/lib/admin/driver-access";
import { validateManagedUserDraft } from "@/lib/admin/user-draft";
import { diffRecords, hasChanges, HIDDEN_VALUE } from "@/lib/audit/diff";
import { recordAudit } from "@/lib/audit/record";
import { isAdminRole, isSuperAdminRole } from "@/lib/auth/roles";
import { canAssignRole, canManageAccount, PROTECTED_ACCOUNT_MESSAGE, SUPERADMIN_ROLE_MESSAGE } from "@/lib/auth/super-admin";
import { errorState, type AdminFormState } from "../form-state";
import { driverDocumentsAudit, validateDriverDocuments, type DriverDocuments } from "@/lib/admin/driver-documents";

/** Los datos de una cuenta que entran a la auditoría. La contraseña nunca: sólo que cambió. */
const auditedUserFields = { email: true, name: true, role: true, isActive: true, monthlySalaryCents: true } as const;

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

/** DNI, licencia y antecedentes del formulario. Se piden siempre que la cuenta sea de chofer. */
function readDriverDocuments(formData: FormData) {
  return validateDriverDocuments({
    documentNumber: value(formData, "documentNumber"),
    cuil: value(formData, "cuil"),
    licenseCategory: value(formData, "licenseCategory"),
    licenseScope: value(formData, "licenseScope"),
    licenseExpiresAt: value(formData, "licenseExpiresAt"),
    criminalRecordExpiresAt: value(formData, "criminalRecordExpiresAt")
  });
}

const driverDocumentFields = {
  documentNumber: true, cuil: true, licenseCategory: true, licenseScope: true, licenseExpiresAt: true, criminalRecordExpiresAt: true
} as const;

function reportError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return errorState("Ese email ya está asociado a otra cuenta.");
  }
  return errorState(error instanceof Error ? error.message : "No pudimos guardar la cuenta.");
}

function notice(message: string, actorRole: string): never {
  redirect(`${managedUsersBasePath(actorRole)}?notice=${encodeURIComponent(message)}`);
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
  const actor = await getCurrentDriverManagerOrRedirect();
  const passwordValue = formData.get("password");
  // La secretaría crea choferes y nada más: el rol se fija en el servidor, no se confía en el form.
  const role = forcedManagedRole(actor.role) ?? value(formData, "role");

  const validated = validateManagedUserDraft({
    email: value(formData, "email"),
    name: value(formData, "name"),
    password: typeof passwordValue === "string" ? passwordValue : "",
    role,
    isActive: value(formData, "isActive") !== "false",
    monthlySalary: value(formData, "monthlySalary")
  });

  const documents = role === "DRIVER" ? readDriverDocuments(formData) : null;
  if (!validated.ok || (documents && !documents.ok)) {
    return errorState(
      documents && !documents.ok && validated.ok ? "Completá la documentación del chofer." : "Revisá los datos de la cuenta.",
      { ...(validated.ok ? {} : validated.errors), ...(documents && !documents.ok ? documents.errors : {}) }
    );
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
      const profile = documents?.ok ? documents.documents : null;
      if (profile) await tx.driverProfile.create({ data: { userId: id, ...profile } });
      await recordAudit(tx, {
        actor, action: "CREATE", entity: "USER", entityId: id, entityLabel: created.email,
        summary: "Cuenta creada desde el panel.",
        changes: diffRecords(null, { ...fields, ...driverDocumentsAudit(profile) })
      });
    });
  } catch (error) {
    return reportError(error);
  }

  refreshUsers();
  notice(
    draft.role === "DRIVER"
      ? `Chofer creado: ${draft.email}. Entregale la contraseña inicial para que entre a su planilla.`
      : `Cuenta creada para ${draft.email}. Entregale la contraseña inicial y pedile que la cambie.`,
    actor.role
  );
}

export async function updateManagedUserAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await getCurrentDriverManagerOrRedirect();
  const id = value(formData, "id");
  // Igual que en el alta: la secretaría no cambia roles, así que el suyo queda fijo en Chofer.
  const roleInput = forcedManagedRole(actor.role) ?? value(formData, "role");
  const name = value(formData, "name");
  const passwordValue = formData.get("password");
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const isActive = value(formData, "isActive") === "true";
  const verSueldo = canSeeSalary(actor.role);

  if (!id || !isManagedUserRole(roleInput)) return errorState("Revisa los datos de la cuenta.");
  const role: ManagedUserRole = roleInput;
  if (!canAssignRole(actor, role)) return errorState(SUPERADMIN_ROLE_MESSAGE, { role: SUPERADMIN_ROLE_MESSAGE });
  if (id === actor.id && (!isAdminRole(role) || !isActive)) {
    return errorState("No podés quitarte el rol de administrador ni desactivar tu propia cuenta.");
  }

  if (password && !isValidPassword(password)) return errorState("La contraseña debe tener al menos 12 caracteres y no superar 72 bytes UTF-8.");
  const documents = role === "DRIVER" ? readDriverDocuments(formData) : null;
  if (documents && !documents.ok) return errorState("Completá la documentación del chofer.", documents.errors);
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id }, select: auditedUserFields });
      if (!before) throw new Error("La cuenta ya no existe.");
      if (!canManageAccount(actor, before)) throw new Error(PROTECTED_ACCOUNT_MESSAGE);
      // La secretaría sólo abre fichas de chofer: el id de una cuenta de administración en la URL no alcanza.
      if (!canManageManagedUser(actor.role, before.role)) throw new Error("Esa cuenta no es de un chofer.");
      await ensureAdminRemains(tx, id, role, isActive);
      // Si el actor no ve el sueldo, el campo no viaja en el formulario: se conserva el que ya tenía.
      const monthlySalaryCents = verSueldo
        ? role === "SECRETARY" || role === "DRIVER"
          ? parseMonthlySalaryCents(value(formData, "monthlySalary"))
          : null
        : before.monthlySalaryCents;
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
      const profileBefore = await tx.driverProfile.findUnique({ where: { userId: id }, select: driverDocumentFields });
      const profile = documents?.ok ? documents.documents : null;
      if (profile) await tx.driverProfile.upsert({ where: { userId: id }, create: { userId: id, ...profile }, update: profile });
      const changes = {
        ...diffRecords(
          { ...before, ...driverDocumentsAudit(profileBefore as DriverDocuments | null) },
          { ...after, ...driverDocumentsAudit(profile ?? (profileBefore as DriverDocuments | null)) }
        ),
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
  notice("Cuenta actualizada.", actor.role);
}

export async function setManagedUserActiveAction(formData: FormData) {
  const actor = await getCurrentDriverManagerOrRedirect();
  const id = value(formData, "id");
  const isActive = value(formData, "isActive") === "true";
  if (actor.id === id && !isActive) notice("No podés desactivar tu propia cuenta.", actor.role);
  try {
    await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id }, select: { email: true, role: true, isActive: true } });
      if (!target) throw new Error("La cuenta ya no existe.");
      if (!canManageAccount(actor, target)) throw new Error(PROTECTED_ACCOUNT_MESSAGE);
      // La secretaría activa y desactiva choferes: es parte de armar el día. Otras cuentas, no.
      if (!canManageManagedUser(actor.role, target.role)) throw new Error("Esa cuenta no es de un chofer.");
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
    notice(error instanceof Error ? error.message : "No pudimos cambiar el estado.", actor.role);
  }
  refreshUsers();
  notice(isActive ? "Cuenta activada." : "Cuenta desactivada.", actor.role);
}

export async function deleteManagedUserAction(formData: FormData) {
  const actor = await getCurrentAdminOrRedirect();
  const id = value(formData, "id");
  if (!id || actor.id === id) notice("No podés eliminar tu propia cuenta.", actor.role);

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
    notice(error instanceof Error ? error.message : "No pudimos eliminar la cuenta.", actor.role);
  }

  refreshUsers();
  notice("Cuenta eliminada y acceso revocado.", actor.role);
}
