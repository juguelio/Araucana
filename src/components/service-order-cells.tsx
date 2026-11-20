import { whatsappLink } from "@/lib/airport/route-order";
import { FormaDePagoOrden } from "./forma-de-pago-orden";

/**
 * Contenido de una celda de la orden de servicio. Lo comparten la hoja de sólo lectura y la recorrida
 * editable del panel, así que no lleva `"use client"`.
 *
 * El contacto lleva al lado el botón de WhatsApp del listado de reservas para que el chofer lo abra con
 * un toque (pedido del cliente); el resto de las celdas es texto. El número se muestra igual que se cargó, sin normalizar a la vista.
 */
export function CeldaDeLaOrden({ celda, columna }: { celda: string; columna: string }) {
  if (columna === "Forma de pago") return <FormaDePagoOrden metodo={celda} />;
  if (!celda) return <span className="orden-vacio">—</span>;
  if (columna !== "Contacto") return <>{celda}</>;
  const whatsapp = whatsappLink(celda);
  if (!whatsapp) return <>{celda}</>;
  // El mismo botón verde «W» que el listado de reservas: un solo criterio visual para abrir WhatsApp.
  return (
    <span className="orden-contacto">
      {celda}
      <a
        className="whatsapp-link orden-whatsapp-boton"
        href={whatsapp}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Enviar WhatsApp a ${celda}`}
        title="Enviar WhatsApp"
      >
        W
      </a>
    </span>
  );
}
