import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { ServicePublicNav } from "@/components/service-public-nav";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { roleCanAccess } from "@/lib/auth/roles";
import { WeeklyCalendar } from "@/components/weekly-calendar/weekly-calendar";
import { calendarWeekStart } from "@/lib/admin/weekly-calendar";
import { argentinaDateKey } from "@/lib/booking/admin-filters";
import { lunesDe } from "@/lib/school-runs/week";
import { leerTerminalSemanal, loadPublicServiceWeek } from "./data";

export const metadata = { title: "Servicio público · Semana · La Araucana" };
export const dynamic = "force-dynamic";

export default async function ServicioPublicoSemanaPage({ searchParams }: {
  searchParams: Promise<{ semana?: string; terminal?: string }>;
}) {
  const user = await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const hoy = argentinaDateKey();
  const filtro = leerTerminalSemanal(params.terminal);
  const semana = calendarWeekStart(params.semana) ?? lunesDe(hoy);
  const initial = await loadPublicServiceWeek(semana, filtro);
  const dataUrl = `/admin/servicio-publico/semana/datos${filtro ? `?terminal=${filtro}` : ""}`;

  return (
    <AdminShell
      title="Servicio público"
      eyebrow="Semana"
      role={user.role}
      action={
        <div className="form-actions">
          <Link className="ghost-button" href="/admin/salidas-del-dia">Salidas del día</Link>
          <Link className="button" href="/admin/reservas/nueva">Vender pasaje</Link>
        </div>
      }
    >
      <ServicePublicNav actual="boleteria" mostrarRutas={roleCanAccess(user.role, ["ADMIN"])} />

      <WeeklyCalendar key={`${semana}:${filtro ?? ""}`} start={semana} today={hoy} initial={initial} dataUrl={dataUrl}
        label="Calendario de servicio público" singular="salida" plural="salidas" empty="Sin salidas" />
    </AdminShell>
  );
}
