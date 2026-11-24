import { horaEnSalta, type ServiceOrderBlock } from "@/lib/airport/service-order";
import type { ExcursionSheetBlock } from "@/lib/excursions/sheet";
import { ExcursionSheet } from "./excursion-sheet";
import { ServiceOrderSheet } from "./service-order-sheet";
import type { ServicePrintDocument } from "./service-print-selection";

export function airportPrintDocuments(date: string, blocks: readonly ServiceOrderBlock[]): ServicePrintDocument[] {
  return blocks.map((block) => ({
    id: block.key,
    title: `${block.direction === "ARRIVAL" ? "IN" : "OUT"} · ${block.flightNumber}`,
    detail: [horaEnSalta(block.operationAt), block.vehicle?.name].filter(Boolean).join(" · "),
    content: <ServiceOrderSheet date={date} blocks={[block]} variante="chofer" mostrarResumen={false} />
  }));
}

export function excursionPrintDocuments(date: string, blocks: readonly ExcursionSheetBlock[]): ServicePrintDocument[] {
  return blocks.map((block) => ({
    id: block.key,
    title: block.excursionName,
    detail: horaEnSalta(block.departureAt),
    content: <ExcursionSheet date={date} blocks={[block]} variante="guia" />
  }));
}
