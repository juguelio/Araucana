import {
  EXCURSION_SHEET_COLUMNS,
  excursionBlockLabel,
  excursionSheetRow,
  type ExcursionSheetBlock
} from "@/lib/excursions/sheet";
import { fechaDeLaOrden, plata } from "@/lib/airport/service-order";
import "./service-order-sheet.css";

type ExcursionSheetProps = {
  date: string;
  blocks: ExcursionSheetBlock[];
  /** `panel` agrega la columna «Acción»; `guia` es de sólo lectura para el link público. */
  variante?: "panel" | "guia";
};

/**
 * La planilla de excursiones como documento (issue #110): misma hoja de estilos y misma estructura que
 * la orden de servicio del chofer — banda por salida, columnas de pasajero y **«Derivado por»**.
 */
export function ExcursionSheet({ date, blocks, variante = "panel" }: ExcursionSheetProps) {
  const totalPasajeros = blocks.reduce((suma, bloque) => suma + bloque.passengers.reduce((n, p) => n + p.seats, 0), 0);
  const totalDelDia = blocks.reduce((suma, bloque) => suma + bloque.totalCents, 0);
  const currency = blocks[0]?.passengers[0]?.currency ?? "ARS";
  const conAcciones = variante === "panel";

  return (
    <article className="orden">
      <header className="orden-cabecera">
        <div>
          <p className="orden-marca">La Araucana viajes S.R.L.</p>
          <h1 className="orden-titulo">PLANILLA DE EXCURSIONES</h1>
          <p className="orden-subtitulo">Excursiones de la Patagonia</p>
        </div>
        <div className="orden-fecha">
          <span>Fecha</span>
          <strong>{fechaDeLaOrden(date)}</strong>
          <span>{blocks.length === 1 ? "Una salida" : "Día completo"}</span>
        </div>
      </header>

      {blocks.length === 0 ? (
        <p className="orden-vacia">No hay ventas de excursiones para ese día.</p>
      ) : (
        blocks.map((block) => (
          <section className="orden-bloque" key={block.key}>
            <h2 className="orden-bloque-titulo">{excursionBlockLabel(block)}</h2>
            <table className="orden-tabla">
              <thead>
                <tr>
                  {EXCURSION_SHEET_COLUMNS.map((columna) => (
                    <th key={columna}>{columna}</th>
                  ))}
                  {conAcciones ? <th className="orden-acciones no-print">Acción</th> : null}
                </tr>
              </thead>
              <tbody>
                {block.passengers.map((pasajero) => (
                  <tr key={pasajero.code}>
                    {excursionSheetRow(pasajero).map((celda, indice) => (
                      <td key={`${pasajero.code}-${indice}`} data-columna={EXCURSION_SHEET_COLUMNS[indice]}>
                        {celda || <span className="orden-vacio">—</span>}
                      </td>
                    ))}
                    {conAcciones ? (
                      <td className="orden-acciones no-print">
                        <span className="orden-vacio">{pasajero.code.slice(-8)}</span>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={EXCURSION_SHEET_COLUMNS.length - 2}>Total {block.excursionName}</td>
                  <td>{plata(block.totalCents, currency)}</td>
                  <td />
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
            {totalPasajeros} pasajero(s) · {blocks.length} salida(s)
          </span>
          <strong>TOTAL DEL DÍA {plata(totalDelDia, currency)}</strong>
        </footer>
      ) : null}

      <p className="orden-pie">
        «Derivado por» es la agencia o voucher que originó la venta; si se vendió directo, va vacío. Cobrar / Pagado es el
        estado del pago.
      </p>
    </article>
  );
}
