import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { createScheduleAction } from "../../../../salidas/actions";
import { getScheduleFormData } from "../../../../salidas/form-data";
import { ScheduleForm } from "../../../../salidas/schedule-form";

type NewRouteSchedulePageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ date?: string }>;
};

export default async function NewRouteSchedulePage({ params, searchParams }: NewRouteSchedulePageProps) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const { id } = await params;
  const query = await searchParams;
  const { routes, vehicles } = await getScheduleFormData();
  const departureAt = query?.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date)
    ? new Date(`${query.date}T09:00:00-03:00`)
    : undefined;

  return (
    <AdminShell role={sessionUser.role} title="Agregar salida" eyebrow="Salidas de la ruta">
      <section className="plain-card admin-section">
        <h2>Nueva salida</h2>
        <ScheduleForm
          action={createScheduleAction}
          routes={routes}
          vehicles={vehicles}
          schedule={{ routeId: id, departureAt }}
          submitLabel="Crear salida"
        />
      </section>
    </AdminShell>
  );
}
