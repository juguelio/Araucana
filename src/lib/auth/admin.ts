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

export async function getCurrentReservationsUserOrRedirect() {
  return getCurrentEmployeeOrRedirect(["ADMIN", "SECRETARY"]);
}

export async function getCurrentDriverOrRedirect() {
  return getCurrentEmployeeOrRedirect(["DRIVER"]);
}
