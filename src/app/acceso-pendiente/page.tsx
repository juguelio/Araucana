import { redirect } from "next/navigation";
import { LogoutButton } from "@/app/admin/logout-button";
import { getDefaultPathForRole } from "@/lib/auth/roles";
import { getAppUserFromToken } from "@/lib/auth/service";

export default async function PendingApprovalPage() {
  const user = await getAppUserFromToken();
  if (!user) redirect("/login");
  if (user.isActive) redirect(getDefaultPathForRole(user.role));

  return (
    <main className="page-shell section">
      <section className="plain-card admin-section" aria-labelledby="pending-title">
        <p className="eyebrow">Cuenta registrada</p>
        <h1 className="section-title" id="pending-title">Tu acceso está pendiente de aprobación</h1>
        <p className="lead">Un administrador de Araucana debe habilitar tu cuenta. Por ahora no tenés acceso a las funciones internas.</p>
        <p className="muted">Cuenta: {user.email}</p>
        <LogoutButton />
      </section>
    </main>
  );
}
