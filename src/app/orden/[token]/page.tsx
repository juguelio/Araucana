import { notFound } from "next/navigation";
import { ImprimirButton } from "@/components/imprimir-button";
import { ServiceOrderSheet } from "@/components/service-order-sheet";
import { ServiceOrderMap } from "@/components/service-order-map";
import { getAirportServiceOrder } from "@/lib/airport/service-order-data";
import { filtrarPorNave, ordenesDelVuelo } from "@/lib/airport/service-order";
import { leerTokenDeOrden } from "@/lib/airport/service-order-link";
import "@/components/service-order-sheet.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Orden de servicio · La Araucana Viajes",
  // Es un link privado para el chofer: no se indexa ni se filtra el origen a terceros.
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const
};

type PageProps = { params: Promise<{ token: string }> };

/**
 * Orden de servicio pública para el chofer (issue #118, parte 2).
 *
 * Se abre sin usuario con un token firmado en la URL: sólo muestra la hoja de ese día (o de ese vuelo, o
 * de una nave de ese vuelo),
 * no da acceso a ninguna otra cosa, no se indexa y vence al día siguiente del servicio. Pensada para el
 * celular: la tabla se lee sin zoom horizontal y también se puede imprimir desde el navegador.
 */
export default async function OrdenPublicaPage({ params }: PageProps) {
  const { token } = await params;
  const payload = leerTokenDeOrden(token);

  if (!payload) {
    notFound();
  }

  const { blocks: ordenesDelDia, oficina } = await getAirportServiceOrder(payload.date, payload.flight);
  const blocks = filtrarPorNave(
    ordenesDelVuelo(ordenesDelDia, payload.flight ?? null),
    payload.flight ? (payload.vehicle ?? null) : null
  );

  return (
    <main className="page-shell section orden-publica">
      <div className="orden-publica-acciones no-print">
        <ImprimirButton />
      </div>
      <ServiceOrderSheet
        date={payload.date}
        blocks={blocks}
        variante="chofer"
        pieDeOrden={(block) => <ServiceOrderMap block={block} oficina={oficina} />}
      />
      <p className="orden-pie orden-publica-pie no-print">La Araucana Viajes S.R.L. · San Martín de los Andes</p>
    </main>
  );
}
