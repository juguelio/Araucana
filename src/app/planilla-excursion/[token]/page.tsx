import { notFound } from "next/navigation";
import { ImprimirButton } from "@/components/imprimir-button";
import { ExcursionSheet } from "@/components/excursion-sheet";
import { getExcursionBookingsForDay } from "@/lib/excursions/booking-repository";
import { buildExcursionSheetBlocks } from "@/lib/excursions/sheet";
import { leerTokenDeOrden, PROPOSITO_EXCURSION } from "@/lib/airport/service-order-link";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Planilla de excursiones · La Araucana Viajes",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const
};

type PageProps = { params: Promise<{ token: string }> };

/**
 * Planilla de excursiones pública (issue #110): el guía la abre sin usuario, igual que el chofer abre la
 * orden de servicio. Sólo muestra la planilla de ese día, no se indexa y vence al día siguiente.
 */
export default async function PlanillaPublicaPage({ params }: PageProps) {
  const { token } = await params;
  const payload = leerTokenDeOrden(token, new Date(), PROPOSITO_EXCURSION);

  if (!payload) {
    notFound();
  }

  const blocks = buildExcursionSheetBlocks(await getExcursionBookingsForDay(payload.date, payload.flight));

  return (
    <main className="page-shell section orden-publica">
      <div className="orden-publica-acciones no-print">
        <ImprimirButton />
      </div>
      <ExcursionSheet date={payload.date} blocks={blocks} variante="guia" />
      <p className="orden-pie orden-publica-pie">La Araucana Viajes S.R.L. · San Martín de los Andes</p>
    </main>
  );
}
