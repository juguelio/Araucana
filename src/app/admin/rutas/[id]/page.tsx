import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { updateRouteAction } from "../actions";
import { RouteForm } from "../route-form";

type EditRoutePageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditRoutePage({ params }: EditRoutePageProps) {
  await getCurrentAdminOrRedirect();
  const { id } = await params;
  const route = await prisma.travelRoute.findUnique({ where: { id } });

  if (!route) {
    notFound();
  }

  return (
    <AdminShell
      title="Editar ruta"
      action={
        <div className="inline-actions">
          <Link className="ghost-button" href="/admin/rutas">Volver a rutas</Link>
          <Link className="button" href={`/admin/rutas/${route.id}/salidas`}>Ver salidas</Link>
        </div>
      }
    >
      <section className="plain-card admin-section">
        <h2>
          {route.from} → {route.to}
        </h2>
        <RouteForm
          action={updateRouteAction}
          route={{
            ...route,
            price: route.priceCents / 100
          }}
          submitLabel="Guardar cambios"
        />
      </section>
    </AdminShell>
  );
}
