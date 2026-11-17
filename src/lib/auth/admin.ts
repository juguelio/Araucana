import { redirect } from "next/navigation";
import { getAppUserFromToken } from "@/lib/auth/service";
import { AppRole, getDefaultPathForRole, roleCanAccess } from "@/lib/auth/roles";

async function getCurrentEmployeeOrRedirect(allowedRoles: AppRole[]) {
  const user = await getAppUserFromToken();

  if (!user) {
    redirect("/login");
  }

  if (!user.isActive) {
    redirect("/acceso-pendiente");
  }

  if (!roleCanAccess(user.role, allowedRoles)) {
    redirect(getDefaultPathForRole(user.role));
  }

  return user;
}

export async function getCurrentAdminOrRedirect() {
  return getCurrentEmployeeOrRedirect(["ADMIN"]);
}

/** Sólo el rol SUPERADMIN. Un administrador común vuelve al panel. */
export async function getCurrentSuperAdminOrRedirect() {
  return getCurrentEmployeeOrRedirect(["SUPERADMIN"]);
}

export async function getCurrentReservationsUserOrRedirect() {
  return getCurrentEmployeeOrRedirect(["ADMIN", "SECRETARY"]);
}

/**
 * Alta y edición de choferes: administración y secretaría, que es quien arma el día y sabe quién
 * maneja. La secretaría entra con reglas más chicas (sólo cuentas de chofer, sin sueldos ni borrado),
 * que se aplican en `@/lib/admin/driver-access`.
 */
export async function getCurrentDriverManagerOrRedirect() {
  return getCurrentEmployeeOrRedirect(["ADMIN", "SECRETARY"]);
}

export async function getCurrentDriverOrRedirect() {
  return getCurrentEmployeeOrRedirect(["DRIVER"]);
}
