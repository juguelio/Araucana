import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { listAdminReservations, listAdminSchedules, listPublicRoutes } from "@/lib/booking/repository";
import { LogoutButton } from "./logout-button";

type AdminPageProps = {
  searchParams?: Promise<{
    notice?: string;
  }>;
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const user = await getCurrentAdminOrRedirect();
  const params = await searchParams;
  const [routes, schedules, reservations] = await Promise.all([
    listPublicRoutes(),
    listAdminSchedules(),
    listAdminReservations()
  ]);

  return (
    <AdminShell title="Panel" eyebrow="Gestión comercial y operativa" action={<LogoutButton />} notice={params?.notice}>
      <div className="plain-card" style={{ marginBottom: 24 }}>
        <p className="eyebrow">Sesion activa</p>
        <p className="lead">Ingresaste como {user.email}. Gestioná usuarios y sus roles junto con rutas, salidas y reservas desde un solo lugar.</p>
      </div>

      <section className="admin-grid">
        <div className="admin-card">
          <span className="muted">Rutas publicadas</span>
          <strong>{routes.length}</strong>
        </div>
        <div className="admin-card">
          <span className="muted">Salidas próximas</span>
          <strong>{schedules.length}</strong>
        </div>
        <div className="admin-card">
          <span className="muted">Reservas activas</span>
          <strong>{reservations.length}</strong>
        </div>
      </section>
    </AdminShell>
  );
}
