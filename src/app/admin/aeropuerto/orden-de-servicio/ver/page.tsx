import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { ServiceOrderSheet } from "@/components/service-order-sheet";
import { getAirportServiceOrderReservations } from "@/lib/airport/service-order-repository";
import { buildServiceOrderBlocks } from "@/lib/airport/service-order";
import { linkDeLaOrden } from "@/lib/airport/service-order-link";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { CopiarLink } from "@/components/copiar-link";
import { ImprimirButton } from "@/components/imprimir-button";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Orden de servicio · La Araucana Viajes",
  robots: { index: false, follow: false }
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type VerOrdenPageProps = {
  searchParams?: Promise<{ date?: string; flight?: string }>;
};

/** Hoy en San Martín de los Andes, como `YYYY-MM-DD` (mismo criterio que la descarga del .xlsx). */
function diaDeHoy() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Salta" }).format(new Date());
}

/**
 * La orden de servicio en pantalla: la misma hoja que se baja en .xlsx, con las mismas columnas y los
 * mismos bloques por vuelo (issue #118).
 *
 * Sirve para verla sin descargar, imprimirla desde el navegador y corregir un dato de cada reserva. Y
 * desde acá se saca el link firmado para el chofer, que la abre sin usuario.
 */
export default async function VerOrdenDeServicioPage({ searchParams }: VerOrdenPageProps) {
  await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const date = params?.date ?? diaDeHoy();
  const flightId = params?.flight || null;

  if (!DATE_PATTERN.test(date)) {
    notFound();
  }

  const blocks = buildServiceOrderBlocks(await getAirportServiceOrderReservations(date, flightId));
  const cabeceras = await headers();
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? "localhost:3000";
  const protocolo =
    cabeceras.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const linkChofer = linkDeLaOrden(`${protocolo}://${host}`, date, flightId);
  const excelHref = `/admin/aeropuerto/orden-de-servicio?date=${encodeURIComponent(date)}${flightId ? `&flight=${encodeURIComponent(flightId)}` : ""}`;

  return (
    <AdminShell
      title="Orden de servicio"
      eyebrow="Operación"
      action={
        <div className="form-actions no-print">
          <ImprimirButton />
          <a className="ghost-button" href={excelHref}>Descargar Excel</a>
          <Link className="ghost-button" href={`/admin/aeropuerto?date=${encodeURIComponent(date)}`}>Volver a aeropuerto</Link>
        </div>
      }
    >
      <CopiarLink url={linkChofer} />
      <ServiceOrderSheet date={date} blocks={blocks} variante="panel" />
    </AdminShell>
  );
}
