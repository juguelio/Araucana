import type { ReactNode } from "react";
import Link from "next/link";
import {
  blockTimeLabel,
  fechaDeLaOrden,
  inicioDeRecorrida,
  plata,
  SERVICE_ORDER_COLUMNS,
  serviceOrderRow,
  tituloDelTotal,
  type ServiceOrderBlock
} from "@/lib/airport/service-order";
import { CeldaDeLaOrden } from "./service-order-cells";
import "./service-order-sheet.css";

type ServiceOrderSheetProps = {
  date: string;
  blocks: ServiceOrderBlock[];
  /** `panel` agrega la columna «Acción» con el link a la ficha; `chofer` es de sólo lectura. */
  variante?: "panel" | "chofer";
  /** Botones de cada orden (imprimir, Excel, link): sólo el panel. */
  accionesDeOrden?: (block: ServiceOrderBlock) => ReactNode;
  /** Reemplaza las filas de una orden, para la recorrida editable del panel. Devuelve un `<tbody>`, o nada para usar las filas de sólo lectura. */
  filasDeOrden?: (block: ServiceOrderBlock) => ReactNode;
  /** Lo que va debajo de cada orden (el mapa del recorrido en el panel). */
  pieDeOrden?: (block: ServiceOrderBlock) => ReactNode;
};

/** `id` HTML de una orden: lo usa el botón de imprimir para dejar sólo esa en el papel. */
export const idDeLaOrden = (block: ServiceOrderBlock) => `orden-${block.key.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;

/**
 * La orden de servicio como documento, compartida por la pantalla del panel y el link del chofer
 * (issue #118). Sale de los mismos `blocks` que arma el .xlsx: una sola fuente para pantalla, papel y
 * Excel. Cada bloque es una orden: un vuelo, o una nave del vuelo cuando sale con más de una.
 */
export function ServiceOrderSheet({ date, blocks, variante = "panel", accionesDeOrden, filasDeOrden, pieDeOrden }: ServiceOrderSheetProps) {
  const totalDelDia = blocks.reduce((suma, bloque) => suma + bloque.totalCents, 0);
  const totalPasajeros = blocks.reduce((suma, bloque) => suma + bloque.passengers.reduce((n, p) => n + p.seats, 0), 0);
  const currency = blocks.find((bloque) => bloque.passengers.length)?.passengers[0]?.currency ?? "ARS";
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
          <span className="orden-fecha-alcance">{blocks.length === 1 ? "Una orden" : `${blocks.length} órdenes`}</span>
        </div>
      </header>

      {blocks.length === 0 ? (
        <p className="orden-vacia">No hay reservas de aeropuerto para ese día.</p>
      ) : (
        blocks.map((block) => {
          const filasPropias = filasDeOrden?.(block);
          const inicio = inicioDeRecorrida(block);
          return (
          <section className="orden-bloque" key={block.key} id={idDeLaOrden(block)}>
            <div className="orden-bloque-cabeza">
              <h2 className="orden-bloque-titulo">
                {inicio ? (
                  <span className="orden-inicio-recorrida">
                    <span className="orden-inicio-rotulo">Inicio de recorrida</span> <strong>{inicio}</strong>
                  </span>
                ) : null}
                <span>{blockTimeLabel(block, { sinRecorrida: Boolean(inicio) })}</span>
              </h2>
              {accionesDeOrden ? accionesDeOrden(block) : null}
            </div>
            <table className="orden-tabla">
              <thead>
                <tr>
                  {SERVICE_ORDER_COLUMNS.map((columna) => (
                    <th key={columna}>{columna}</th>
                  ))}
                  {conAcciones ? <th className="orden-acciones no-print">Acción</th> : null}
                </tr>
              </thead>
              {filasPropias ?? (
                <tbody>
                  {block.passengers.map((pasajero, parada) => (
                    <tr key={pasajero.code}>
                      {serviceOrderRow(pasajero).map((celda, indice) => (
                        <td key={`${pasajero.code}-${indice}`} data-columna={SERVICE_ORDER_COLUMNS[indice]}>
                          {indice === 0 ? <span className="orden-parada-numero">{parada + 1}.</span> : null}
                          {indice === 0 ? " " : null}
                          <CeldaDeLaOrden celda={celda} columna={SERVICE_ORDER_COLUMNS[indice]} />
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
              )}
              <tfoot>
                <tr>
                  <td colSpan={SERVICE_ORDER_COLUMNS.length - 1}>{tituloDelTotal(block)}</td>
                  <td>{plata(block.totalCents, currency)}</td>
                  {conAcciones ? <td className="no-print" /> : null}
                </tr>
              </tfoot>
            </table>
            {pieDeOrden ? pieDeOrden(block) : null}
          </section>
          );
        })
      )}

      {blocks.length > 0 ? (
        <footer className="orden-total">
          <span>
            {totalPasajeros} pasajero(s) · {blocks.length} {blocks.length === 1 ? "orden" : "órdenes"}
          </span>
          <strong>TOTAL DEL DÍA {plata(totalDelDia, currency)}</strong>
        </footer>
      ) : null}

      <p className="orden-pie">
        «Derivado por» es el origen que se cargó en la reserva (agencia o voucher); si la venta fue directa, va vacío.
        Cobrar / Pagado es el estado del pago. Las filas están en el orden de la recorrida: el que se acomodó a mano en
        el panel y, si no, el sugerido: en los arribos, desde el aeropuerto con el más cercano primero; en las partidas, al
        revés, del más lejano al más cercano al aeropuerto. Al final van los pasajeros que no tienen el punto marcado en
        el mapa. Si el vuelo sale con más de una nave, hay una orden por nave. El
        botón verde «W» al lado del contacto abre el WhatsApp.
      </p>
    </article>
  );
}
