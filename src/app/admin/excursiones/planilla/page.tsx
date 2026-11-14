import Link from "next/link";
import { headers } from "next/headers";
import { CopiarLink } from "@/components/copiar-link";
import { linkDeLaPlanilla } from "@/lib/airport/service-order-link";
import { AdminShell } from "@/components/admin-shell";
import { ExcursionSheet } from "@/components/excursion-sheet";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { buildExcursionSheetBlocks } from "@/lib/excursions/sheet";
import { getExcursionBookingsForDay } from "@/lib/excursions/booking-repository";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Planilla de excursiones · La Araucana Viajes",
  robots: { index: false, follow: false }
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Hoy en San Martín de los Andes, como `YYYY-MM-DD`. */
function diaDeHoy() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Salta" }).format(new Date());
}

/**
 * Planilla de excursiones (issue #110): la misma hoja que la orden de servicio del chofer, con las
 * ventas del día agrupadas por salida y la columna «Derivado por».
 */
export default async function PlanillaDeExcursionesPage({
  searchParams
}: {
  searchParams: Promise<{ date?: string; excursion?: string }>;
}) {
  await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const date = params?.date ?? diaDeHoy();
  const excursionId = params?.excursion || null;

  if (!DATE_PATTERN.test(date)) {
    return (
      <AdminShell title="Planilla de excursiones" eyebrow="Operación">
        <p className="form-error">La fecha tiene que ser YYYY-MM-DD.</p>
      </AdminShell>
    );
  }

  const blocks = buildExcursionSheetBlocks(await getExcursionBookingsForDay(date, excursionId));
  const cabeceras = await headers();
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? "localhost:3000";
  const protocolo = cabeceras.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const linkGuia = linkDeLaPlanilla(`${protocolo}://${host}`, date, excursionId);
  const query = `date=${encodeURIComponent(date)}${excursionId ? `&excursion=${encodeURIComponent(excursionId)}` : ""}`;

  return (
    <AdminShell
      title="Planilla de excursiones"
      eyebrow="Operación"
      action={
        <div className="form-actions no-print">
          <a className="ghost-button" href={`/admin/excursiones/planilla/xlsx?${query}`}>Descargar Excel</a>
          <Link className="ghost-button" href={`/admin/excursiones?date=${encodeURIComponent(date)}`}>Volver a excursiones</Link>
        </div>
      }
    >
      <CopiarLink url={linkGuia} rotulo="Link para el guía" ayuda="La abre sin usuario y vence al día siguiente de la excursión. Mandásela por WhatsApp." />
      <ExcursionSheet date={date} blocks={blocks} variante="panel" />
    </AdminShell>
  );
}
