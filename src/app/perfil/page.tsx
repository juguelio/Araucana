import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/app/admin/logout-button";
import { getDefaultPathForRole } from "@/lib/auth/roles";
import { getAppUserFromToken } from "@/lib/auth/service";
import { prisma } from "@/lib/db/prisma";
import { PasswordForm, ProfileForm } from "./profile-forms";
import "./profile.css";

export const metadata: Metadata = {
  title: "Mi perfil | La Araucana",
  robots: { index: false, follow: false }
};

export default async function ProfilePage() {
  const user = await getAppUserFromToken();
  if (!user) redirect("/login");

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true, googleSub: true }
  });
  if (!account) redirect("/login");

  const panelPath = user.isActive ? getDefaultPathForRole(user.role) : "/acceso-pendiente";

  return (
    <main className="page-shell section profile-page">
      <h1 className="section-title">Mi perfil</h1>
      <div className="split profile-forms">
        <ProfileForm name={user.name ?? ""} email={user.email} />
        {account.passwordHash ? (
          <PasswordForm />
        ) : (
          <section className="form-panel">
            <h2>Contraseña</h2>
            <p className="muted">
              {account.googleSub
                ? "Ingresás con Google. Podés gestionar tu contraseña desde tu cuenta de Google."
                : "Tu cuenta todavía no tiene una contraseña de Araucana."}
            </p>
          </section>
        )}
      </div>
      <div className="profile-actions">
        {panelPath !== "/" ? (
          <Link className="button" href={panelPath}>{user.isActive ? "Ir al panel" : "Ver estado de acceso"}</Link>
        ) : null}
        <LogoutButton label="Cerrar sesión" />
      </div>
    </main>
  );
}
