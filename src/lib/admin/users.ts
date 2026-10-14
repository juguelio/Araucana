import type { AppRole } from "@/lib/auth/roles";

export const managedUserRoles = ["ADMIN", "SECRETARY", "DRIVER", "USER"] as const satisfies readonly AppRole[];
export type ManagedUserRole = (typeof managedUserRoles)[number];

const roleNames: Record<ManagedUserRole, string> = {
  ADMIN: "Administrador",
  SECRETARY: "Secretaria",
  DRIVER: "Chofer",
  USER: "Usuario"
};

export function isManagedUserRole(role: string): role is ManagedUserRole {
  return managedUserRoles.includes(role as ManagedUserRole);
}

export function getManagedUserRoleName(role: ManagedUserRole) {
  return roleNames[role];
}

export function getManagedUserPath(_role?: ManagedUserRole, suffix = "") {
  return `/admin/usuarios${suffix}`;
}
