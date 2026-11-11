import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { updateScheduleAction } from "@/app/admin/salidas/actions";
import { getScheduleFormData } from "@/app/admin/salidas/form-data";
import { ScheduleForm } from "@/app/admin/salidas/schedule-form";

type EditRouteSchedulePageProps = {
  params: Promise<{ id: string; scheduleId: string }>;
  searchParams: Promise<{ notice?: string; status?: string }>;
};

export default async function EditRouteSchedulePage({ params, searchParams }: EditRouteSchedulePageProps) {
  await getCurrentAdminOrRedirect();
  const [{ id: routeId, scheduleId }, query] = await Promise.all([params, searchParams]);
  const [schedule, formData] = await Promise.all([
    prisma.schedule.findFirst({ where: { id: scheduleId, routeId }, include: { route: true } }),
    getScheduleFormData()
  ]);
  if (!schedule) notFound();
  const status = query.status && ["OPEN", "DOCUMENTATION", "CLOSED"].includes(query.status) ? query.status : schedule.status;
  const detail = `/admin/rutas/${routeId}/salidas/${scheduleId}`;

  return (
    <AdminShell title="Editar salida" eyebrow="Salidas de la ruta" notice={query.notice}
      action={<Link className="ghost-button" href={detail}>Volver a la salida</Link>}>
      <section className="plain-card admin-section">
        <h2>{schedule.route.from} → {schedule.route.to}</h2>
        <ScheduleForm action={updateScheduleAction} routes={formData.routes} vehicles={formData.vehicles}
          schedule={{ ...schedule, status }} submitLabel="Guardar cambios" />
      </section>
    </AdminShell>
  );
}
