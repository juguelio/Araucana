export const appRoles = ["SUPERADMIN", "ADMIN", "SECRETARY", "DRIVER", "USER"] as const;

export type AppRole = (typeof appRoles)[number];

export function toPublicRole(role: string): AppRole {
  return appRoles.includes(role as AppRole) ? (role as AppRole) : "USER";
}

/**
 * El super administrador es un administrador con todo lo del administrador y además: ve la
 * auditoría y es el único que nombra (o toca) a otros super administradores. Todo permiso que
 * pregunte "¿es administrador?" tiene que pasar por acá para que también lo incluya.
 */
export function isAdminRole(role: string | null | undefined) {
  return role === "ADMIN" || role === "SUPERADMIN";
}

export function isSuperAdminRole(role: string | null | undefined) {
  return role === "SUPERADMIN";
}

/** Personal de oficina: quienes operan reservas desde el panel. */
export function isOfficeRole(role: string | null | undefined) {
  return isAdminRole(role) || role === "SECRETARY";
}

export function getDefaultPathForRole(role: AppRole) {
  if (isAdminRole(role)) {
    return "/admin";
  }

  if (role === "SECRETARY") {
    return "/admin/reservas";
  }

  if (role === "DRIVER") {
    return "/chofer";
  }

  return "/";
}

/** Lo que puede un ADMIN lo puede el SUPERADMIN, aunque la lista no lo nombre. */
export function roleCanAccess(role: AppRole, allowedRoles: AppRole[]) {
  return allowedRoles.includes(role) || (role === "SUPERADMIN" && allowedRoles.includes("ADMIN"));
}
