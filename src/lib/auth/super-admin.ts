import { isSuperAdminRole } from "./roles";

/**
 * Super administrador: el rol `SUPERADMIN` guardado en la cuenta. Puede todo lo del administrador,
 * ve la auditoría y es el único que asigna ese rol o modifica una cuenta que lo tiene.
 */

type Account = { role: string; isActive: boolean };

export function isSuperAdmin(user: Account | null | undefined) {
  return !!user && user.isActive && isSuperAdminRole(user.role);
}

export const PROTECTED_ACCOUNT_MESSAGE = "Esa cuenta es de un super administrador: sólo otro super administrador puede modificarla.";
export const SUPERADMIN_ROLE_MESSAGE = "Sólo un super administrador puede asignar el rol de super administrador.";

/**
 * Cierra el atajo para escalar privilegios: un administrador común no puede cambiarle la
 * contraseña, desactivar ni borrar una cuenta de super administrador.
 */
export function canManageAccount(actor: Account, target: { role: string }) {
  return !isSuperAdminRole(target.role) || isSuperAdmin(actor);
}

/** Dar el rol (al crear o al editar) es exclusivo del super administrador. */
export function canAssignRole(actor: Account, role: string) {
  return !isSuperAdminRole(role) || isSuperAdmin(actor);
}
