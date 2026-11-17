/**
 * Quién puede gestionar choferes desde el panel.
 *
 * El chofer es una cuenta (`User` con `role: "DRIVER"`), así que el alta vive en el mismo lugar que
 * el resto de las cuentas: `/admin/usuarios`. Pero la secretaría es quien arma el día y necesita dar
 * de alta y editar choferes sin ver el CRM completo.
 *
 * La regla es de mínimos: la secretaría crea y edita **choferes**, y nada más. No elige roles, no ve
 * sueldos y no borra cuentas. Estas funciones son puras para poder probar la regla sin montar una
 * pantalla ni una base.
 */

/** La secretaría gestiona choferes, no cuentas en general. */
export function isDriverOnlyManager(role: string): boolean {
  return role === "SECRETARY";
}

/**
 * El rol que puede asignar un gestor de choferes. `null` significa "puede elegir" (administración).
 * Se aplica en el servidor: el formulario puede mandar cualquier cosa.
 */
export function forcedManagedRole(actorRole: string): "DRIVER" | null {
  return isDriverOnlyManager(actorRole) ? "DRIVER" : null;
}

/** El sueldo es dato de administración: la secretaría no lo ve ni lo edita. */
export function canSeeSalary(actorRole: string): boolean {
  return !isDriverOnlyManager(actorRole);
}

/** Borrar una cuenta sigue siendo de administración; desactivar un chofer sí es del día a día. */
export function canDeleteManagedUser(actorRole: string): boolean {
  return !isDriverOnlyManager(actorRole);
}

/** A dónde vuelve el formulario después de guardar, y dónde vive el listado para ese actor. */
export function managedUsersBasePath(actorRole: string): string {
  return isDriverOnlyManager(actorRole) ? "/admin/choferes" : "/admin/usuarios";
}

/**
 * ¿Puede este actor tocar esta cuenta? La secretaría sólo cuentas que ya son de chofer, para que el
 * id de una cuenta de administración en la URL no le abra la ficha.
 */
export function canManageManagedUser(actorRole: string, targetRole: string): boolean {
  return !isDriverOnlyManager(actorRole) || targetRole === "DRIVER";
}
