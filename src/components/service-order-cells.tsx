import { whatsappLink } from "@/lib/airport/route-order";

/**
 * Contenido de una celda de la orden de servicio. Lo comparten la hoja de sólo lectura y la recorrida
 * editable del panel, así que no lleva `"use client"`.
 *
 * El contacto es un link de WhatsApp para que el chofer lo abra con un click (pedido del cliente); el
 * resto de las celdas es texto. El número se muestra igual que se cargó, sin normalizar a la vista.
 */
export function CeldaDeLaOrden({ celda, columna }: { celda: string; columna: string }) {
  if (!celda) return <span className="orden-vacio">—</span>;
  if (columna !== "Contacto") return <>{celda}</>;
  const whatsapp = whatsappLink(celda);
  if (!whatsapp) return <>{celda}</>;
  return (
    <a className="orden-whatsapp" href={whatsapp} target="_blank" rel="noopener noreferrer">
      {celda}
      <span className="orden-whatsapp-icono" aria-hidden="true"> · WhatsApp</span>
    </a>
  );
}
