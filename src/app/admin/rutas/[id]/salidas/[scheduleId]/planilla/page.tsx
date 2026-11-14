import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { ImprimirButton } from "@/components/imprimir-button";
import { RouteSheetDocument } from "@/components/route-sheet";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { buildRouteSheet } from "@/lib/driver/route-sheet";
import { getRouteSheetInput } from "@/lib/driver/route-sheet-repository";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Planilla del chofer · La Araucana Viajes",
  robots: { index: false, follow: false }
};

type PageProps = {
  params: Promise<{ id: string; scheduleId: string }>;
};

/**
 * Planilla del chofer de una salida de ruta (issue #136): la lista de pasajeros de esa combi, con la
 * misma forma que la orden de servicio del aeropuerto y la planilla de excursiones.
 */
export default async function PlanillaDeSalidaPage({ params }: PageProps) {
  await getCurrentReservationsUserOrRedirect();
  const { id: routeId, scheduleId } = await params;

  const input = await getRouteSheetInput(scheduleId);

  // La salida tiene que pertenecer a la ruta de la URL: un id cruzado no es una planilla válida.
  if (!input) {
    notFound();
  }

  const sheet = buildRouteSheet(input);

  return (
    <AdminShell
      title="Planilla del chofer"
      eyebrow="Operación"
      action={
        <div className="form-actions no-print">
          <a className="ghost-button" href={`/admin/rutas/${routeId}/salidas/${scheduleId}/planilla/xlsx`}>
            Descargar Excel
          </a>
          <Link className="ghost-button" href={`/admin/rutas/${routeId}/salidas/${scheduleId}`}>
            Volver a la salida
          </Link>
        </div>
      }
    >
      <div className="orden-publica-acciones no-print">
        <ImprimirButton />
      </div>
      <RouteSheetDocument sheet={sheet} />
    </AdminShell>
  );
}
