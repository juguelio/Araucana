import Link from "next/link";
import {
  blockTimeLabel,
  fechaDeLaOrden,
  plata,
  SERVICE_ORDER_COLUMNS,
  serviceOrderRow,
  type ServiceOrderBlock
} from "@/lib/airport/service-order";
import { whatsappLink } from "@/lib/airport/route-order";
import "./service-order-sheet.css";

type ServiceOrderSheetProps = {
  date: string;
  blocks: ServiceOrderBlock[];
  /** `panel` agrega la columna «Acción» con el link a la ficha; `chofer` es de sólo lectura. */
  variante?: "panel" | "chofer";
};

/**
 * La orden de servicio como documento, compartida por la pantalla del panel y el link del chofer
 * (issue #118). Sale de los mismos `blocks` que arma el .xlsx: una sola fuente para pantalla, papel y
 * Excel.
 */
/**
 * El contacto es un link de WhatsApp para que el chofer lo abra con un click (pedido del cliente); el
 * resto de las celdas es texto. El número se muestra igual que se cargó, sin normalizar a la vista.
 */
function celdaContenido(celda: string, columna: string) {
  if (columna !== "Contacto") return celda;
  const whatsapp = whatsappLink(celda);
  if (!whatsapp) return celda;
  return (
    <a className="orden-whatsapp" href={whatsapp} target="_blank" rel="noopener noreferrer">
      {celda}
      <span className="orden-whatsapp-icono" aria-hidden="true"> · WhatsApp</span>
    </a>
  );
}

export function ServiceOrderSheet({ date, blocks, variante = "panel" }: ServiceOrderSheetProps) {
  const totalDelDia = blocks.reduce((suma, bloque) => suma + bloque.totalCents, 0);
  const totalPasajeros = blocks.reduce((suma, bloque) => suma + bloque.passengers.reduce((n, p) => n + p.seats, 0), 0);
  const currency = blocks[0]?.passengers[0]?.currency ?? "ARS";
  const conAcciones = variante === "panel";

  return (
    <article className="orden">
      <header className="orden-cabecera">
        <div>
          <p className="orden-marca">La Araucana viajes S.R.L.</p>
          <h1 className="orden-titulo">ORDEN DE SERVICIO</h1>
          <p className="orden-subtitulo">Traslados Aeropuerto Chapelco</p>
        </div>
        <div className="orden-fecha">
          <span>Fecha</span>
          <strong>{fechaDeLaOrden(date)}</strong>
          <span>{blocks.length === 1 ? "Un vuelo" : "Día completo"}</span>
        </div>
      </header>

      {blocks.length === 0 ? (
        <p className="orden-vacia">No hay reservas de aeropuerto para ese día.</p>
      ) : (
        blocks.map((block) => (
          <section className="orden-bloque" key={block.key}>
            <h2 className="orden-bloque-titulo">{blockTimeLabel(block)}</h2>
            <table className="orden-tabla">
              <thead>
                <tr>
                  {SERVICE_ORDER_COLUMNS.map((columna) => (
                    <th key={columna}>{columna}</th>
                  ))}
                  {conAcciones ? <th className="orden-acciones no-print">Acción</th> : null}
                </tr>
              </thead>
              <tbody>
                {block.passengers.map((pasajero) => (
                  <tr key={pasajero.code}>
                    {serviceOrderRow(pasajero).map((celda, indice) => (
                      <td key={`${pasajero.code}-${indice}`} data-columna={SERVICE_ORDER_COLUMNS[indice]}>
                        {celda ? celdaContenido(celda, SERVICE_ORDER_COLUMNS[indice]) : <span className="orden-vacio">—</span>}
                      </td>
                    ))}
                    {conAcciones ? (
                      <td className="orden-acciones no-print">
                        <Link href={`/admin/reservas/${pasajero.code}/editar`}>Editar</Link>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={SERVICE_ORDER_COLUMNS.length - 1}>
                    Total {block.heading} {block.flightNumber}
                  </td>
                  <td>{plata(block.totalCents, currency)}</td>
                  {conAcciones ? <td className="no-print" /> : null}
                </tr>
              </tfoot>
            </table>
          </section>
        ))
      )}

      {blocks.length > 0 ? (
        <footer className="orden-total">
          <span>
            {totalPasajeros} pasajero(s) · {blocks.length} bloque(s)
          </span>
          <strong>TOTAL DEL DÍA {plata(totalDelDia, currency)}</strong>
        </footer>
      ) : null}

      <p className="orden-pie">
        «Derivado por» es el origen que se cargó en la reserva (agencia o voucher); si la venta fue directa, va vacío.
        Cobrar / Pagado es el estado del pago. Las filas están en el orden sugerido desde el aeropuerto: el retiro más
        cercano primero, y al final los pasajeros que no tienen el punto marcado en el mapa. El contacto abre el
        WhatsApp con un toque.
      </p>
    </article>
  );
}
