import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { createRouteAction } from "../actions";
import { RouteForm } from "../route-form";

export default async function NewRoutePage() {
  const sessionUser = await getCurrentAdminOrRedirect();

  return (
    <AdminShell role={sessionUser.role} title="Agregar ruta" action={<Link className="ghost-button" href="/admin/rutas">Volver a rutas</Link>}>
      <section className="plain-card admin-section">
        <h2>Nueva ruta</h2>
        <RouteForm action={createRouteAction} submitLabel="Crear ruta" />
      </section>
    </AdminShell>
  );
}
