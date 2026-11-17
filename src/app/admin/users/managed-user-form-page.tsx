import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { canManageManagedUser, canSeeSalary, forcedManagedRole, managedUsersBasePath } from "@/lib/admin/driver-access";
import { getCurrentAdminOrRedirect, getCurrentDriverManagerOrRedirect } from "@/lib/auth/admin";
import { toPublicRole } from "@/lib/auth/roles";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { prisma } from "@/lib/db/prisma";
import { dayKey } from "@/lib/admin/driver-documents";
import { createManagedUserAction, updateManagedUserAction } from "./actions";
import { ManagedUserForm } from "./user-form";
import "./users.css";

/**
 * Alta de una cuenta. Con `fixedRole` el rol no se elige: es el caso de «Crear chofer» desde
 * `/admin/choferes`, que además abre a la secretaría.
 */
export async function CreateManagedUserPage({ fixedRole }: { fixedRole?: "DRIVER" } = {}) {
  const actor = fixedRole ? await getCurrentDriverManagerOrRedirect() : await getCurrentAdminOrRedirect();
  const esChofer = fixedRole === "DRIVER";

  return (
    <AdminShell role={actor.role} eyebrow="Panel de administración" title={esChofer ? "Nuevo chofer" : "Nueva cuenta"}>
      <section className="plain-card admin-section">
        <h2>{esChofer ? "Crear chofer" : "Crear usuario"}</h2>
        <p className="muted">
          {esChofer
            ? "El chofer entra a la app con su email y contraseña para ver la planilla del día. Queda activo al crearse: si lo dejás inactivo, no aparece para asignar en «Salidas del día»."
            : "La cuenta queda activa al crearse. Entregale el email y la contraseña inicial; puede cambiarla desde su perfil."}
        </p>
        <ManagedUserForm
          action={createManagedUserAction}
          canAssignSuperAdmin={isSuperAdmin(actor)}
          fixedRole={fixedRole}
          showSalary={canSeeSalary(actor.role)}
          backHref={managedUsersBasePath(actor.role)}
        />
      </section>
    </AdminShell>
  );
}

/**
 * Edición de una cuenta. `driversOnly` es la ficha que abre la secretaría: sólo cuentas de chofer y
 * sin poder cambiar el rol.
 */
export async function EditManagedUserPage({ id, driversOnly = false }: { id: string; driversOnly?: boolean }) {
  const actor = driversOnly ? await getCurrentDriverManagerOrRedirect() : await getCurrentAdminOrRedirect();
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, role: true, isActive: true, monthlySalaryCents: true,
      driverProfile: { select: { documentNumber: true, cuil: true, licenseCategory: true, licenseScope: true, licenseExpiresAt: true, criminalRecordExpiresAt: true } }
    }
  });
  if (!user) notFound();
  if (!canManageManagedUser(actor.role, user.role)) notFound();

  const fixedRole = driversOnly && forcedManagedRole(actor.role) === "DRIVER" ? ("DRIVER" as const) : undefined;

  return (
    <AdminShell role={actor.role} title={fixedRole ? "Editar chofer" : "Editar cuenta"}>
      <section className="plain-card admin-section">
        <h2>{user.name ?? user.email}</h2>
        {user.role === "DRIVER" && !user.driverProfile ? (
          <p className="form-alert error">Falta la documentación de este chofer: completá DNI, licencia y antecedentes para guardar.</p>
        ) : null}
        <ManagedUserForm
          action={updateManagedUserAction}
          user={{ id: user.id, email: user.email, name: user.name, isActive: user.isActive, monthlySalaryCents: user.monthlySalaryCents, role: toPublicRole(user.role) }}
          driverDocuments={user.driverProfile ? {
            documentNumber: user.driverProfile.documentNumber,
            cuil: user.driverProfile.cuil ?? "",
            licenseCategory: user.driverProfile.licenseCategory,
            licenseScope: user.driverProfile.licenseScope,
            licenseExpiresAt: dayKey(user.driverProfile.licenseExpiresAt),
            criminalRecordExpiresAt: dayKey(user.driverProfile.criminalRecordExpiresAt)
          } : null}
          canAssignSuperAdmin={isSuperAdmin(actor)}
          fixedRole={fixedRole}
          showSalary={canSeeSalary(actor.role)}
          backHref={managedUsersBasePath(actor.role)}
        />
      </section>
    </AdminShell>
  );
}
