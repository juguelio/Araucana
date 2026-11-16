import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { toPublicRole } from "@/lib/auth/roles";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { prisma } from "@/lib/db/prisma";
import { createManagedUserAction, updateManagedUserAction } from "./actions";
import { ManagedUserForm } from "./user-form";
import "./users.css";

export async function CreateManagedUserPage() {
  const actor = await getCurrentAdminOrRedirect();

  return (
    <AdminShell role={actor.role} eyebrow="Panel de administración" title="Nueva cuenta">
      <section className="plain-card admin-section">
        <h2>Crear usuario</h2>
        <p className="muted">
          La cuenta queda activa al crearse. Entregale el email y la contraseña inicial; puede cambiarla desde su perfil.
        </p>
        <ManagedUserForm action={createManagedUserAction} canAssignSuperAdmin={isSuperAdmin(actor)} />
      </section>
    </AdminShell>
  );
}

export async function EditManagedUserPage({ id }: { id: string }) {
  const actor = await getCurrentAdminOrRedirect();
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, isActive: true, monthlySalaryCents: true }
  });
  if (!user) notFound();

  return (
    <AdminShell role={actor.role} title="Editar cuenta">
      <section className="plain-card admin-section">
        <h2>{user.name ?? user.email}</h2>
        <ManagedUserForm action={updateManagedUserAction} user={{ ...user, role: toPublicRole(user.role) }} canAssignSuperAdmin={isSuperAdmin(actor)} />
      </section>
    </AdminShell>
  );
}
