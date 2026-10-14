import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { updateManagedUserAction } from "./actions";
import { ManagedUserForm } from "./user-form";

export async function EditManagedUserPage({ id }: { id: string }) {
  await getCurrentAdminOrRedirect();
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, isActive: true, monthlySalaryCents: true }
  });
  if (!user) notFound();

  return (
    <AdminShell title="Editar cuenta">
      <section className="plain-card admin-section">
        <h2>{user.name ?? user.email}</h2>
        <ManagedUserForm action={updateManagedUserAction} user={{ ...user, role: user.role as "ADMIN" | "SECRETARY" | "DRIVER" | "USER" }} />
      </section>
    </AdminShell>
  );
}
