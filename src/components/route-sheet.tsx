import {
  ROUTE_SHEET_COLUMNS,
  ROUTE_SHEET_FOOTNOTE,
  routeSheetRow,
  type RouteSheet
} from "@/lib/driver/route-sheet";
import { fechaDeLaOrden, plata } from "@/lib/airport/service-order";
import { whatsappLink } from "@/lib/airport/route-order";
import "./service-order-sheet.css";

/** El contacto abre el WhatsApp del pasajero con un click; el resto de las celdas es texto. */
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

/**
 * La planilla del chofer de una salida de ruta como documento (issue #136): misma hoja de estilos,
 * mismas columnas y mismo pie que la orden de servicio y la planilla de excursiones.
 */
export function RouteSheetDocument({ sheet }: { sheet: RouteSheet }) {
  return (
    <article className="orden">
      <header className="orden-cabecera">
        <div>
          <p className="orden-marca">La Araucana viajes S.R.L.</p>
          <h1 className="orden-titulo">PLANILLA DEL CHOFER</h1>
          <p className="orden-subtitulo">{sheet.routeLabel} · Nave {sheet.vehicle}</p>
        </div>
        <div className="orden-fecha">
          <span>Fecha</span>
          <strong>{fechaDeLaOrden(sheet.date)}</strong>
          <span>Salida programada</span>
        </div>
      </header>

      {sheet.passengers.length === 0 ? (
        <p className="orden-vacia">Esta salida todavía no tiene pasajeros confirmados.</p>
      ) : (
        <section className="orden-bloque">
          <h2 className="orden-bloque-titulo">{sheet.heading}</h2>
          <table className="orden-tabla">
            <thead>
              <tr>
                {ROUTE_SHEET_COLUMNS.map((columna) => (
                  <th key={columna}>{columna}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.passengers.map((pasajero) => (
                <tr key={`${pasajero.code}-${pasajero.name}`}>
                  {routeSheetRow(pasajero).map((celda, indice) => (
                    <td key={`${pasajero.code}-${indice}`} data-columna={ROUTE_SHEET_COLUMNS[indice]}>
                      {celda ? celdaContenido(celda, ROUTE_SHEET_COLUMNS[indice]) : <span className="orden-vacio">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={ROUTE_SHEET_COLUMNS.length - 2}>
                  Total {sheet.routeLabel} · {sheet.totalSeats} pasajero(s)
                </td>
                <td>{plata(sheet.totalCents, sheet.currency)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {sheet.passengers.length > 0 ? (
        <footer className="orden-total">
          <span>
            {sheet.totalSeats} pasajero(s) · {sheet.passengers.length} reserva(s)
          </span>
          <strong>TOTAL DEL VIAJE {plata(sheet.totalCents, sheet.currency)}</strong>
        </footer>
      ) : null}

      <p className="orden-pie">{ROUTE_SHEET_FOOTNOTE}</p>
    </article>
  );
}
