import type { CalendarWeek } from "@/lib/admin/weekly-calendar";
import { prisma } from "@/lib/db/prisma";
import { leerTurno } from "@/lib/school-runs/dia";
import { etiquetaDeConcesion, type SchoolRunKind } from "@/lib/school-runs/kinds";
import { diasDeSemana } from "@/lib/school-runs/week";

/**
 * La semana de Concesiones para el calendario compartido (`WeeklyCalendar`), el mismo que usan
 * Servicio público y Viajes especiales (patrón común, 24-nov). Cada tarjeta abre el día en ese
 * servicio; el estado dice si falta nave o chofer, o si la planilla dejó algo para revisar.
 */
export async function loadConcesionesWeek(start: string, tipo: SchoolRunKind | null): Promise<CalendarWeek> {
  const dias = diasDeSemana(start);
  const runs = await prisma.schoolRun.findMany({
    where: { serviceDate: { gte: new Date(`${dias[0]}T00:00:00Z`), lte: new Date(`${dias[6]}T00:00:00Z`) }, ...(tipo ? { kind: tipo } : {}) },
    orderBy: [{ serviceDate: "asc" }, { routeName: "asc" }, { id: "asc" }],
    select: {
      id: true, serviceDate: true, kind: true, routeName: true, shift: true, companion: true, review: true, driverId: true, vehicleId: true,
      driver: { select: { name: true, email: true } }, vehicle: { select: { name: true } }
    }
  });
  const faltan = runs.filter((run) => !run.driverId || !run.vehicleId).length;
  return {
    summary: [
      { label: "Servicios", value: runs.length },
      { label: "Sin nave o sin chofer", value: faltan },
      { label: "Choferes", value: new Set(runs.map((run) => run.driverId).filter(Boolean)).size }
    ],
    days: dias.map((date) => {
      const href = `/admin/escolares?fecha=${date}${tipo ? `&tipo=${tipo}` : ""}`;
      const delDia = runs
        .filter((run) => run.serviceDate.toISOString().slice(0, 10) === date)
        .sort((a, b) => leerTurno(a.shift).orden - leerTurno(b.shift).orden || a.routeName.localeCompare(b.routeName, "es", { numeric: true }));
      return {
        date,
        href,
        cards: delDia.map((run) => {
          const chofer = run.driver ? run.driver.name?.trim() || run.driver.email : null;
          const falta = !run.driverId || !run.vehicleId;
          return {
            id: run.id,
            // Con su tipo, como arregló #445: «Personal aeropuerto» no cae en la vista de Escolares.
            href: `/admin/escolares?fecha=${date}&tipo=${run.kind}#servicio-${run.id}`,
            kicker: `${etiquetaDeConcesion(run.kind)} · ${leerTurno(run.shift).etiqueta}`,
            title: run.routeName,
            details: [`${chofer ?? "Sin chofer"} · ${run.vehicle?.name ?? "Sin nave"}`, ...(run.companion ? [`Con ${run.companion}`] : [])],
            status: falta
              ? { label: "Falta asignar", tone: "warning" as const }
              : run.review?.trim() ? { label: "Revisar", tone: "warning" as const } : { label: "Listo", tone: "positive" as const }
          };
        })
      };
    })
  };
}
