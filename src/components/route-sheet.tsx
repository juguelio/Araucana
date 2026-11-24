import {
  ROUTE_SHEET_COLUMNS,
  ROUTE_SHEET_FOOTNOTE,
  routeSheetRow,
  type RouteSheet
} from "@/lib/driver/route-sheet";
import { fechaDeLaOrden, plata } from "@/lib/airport/service-order";
import { CeldaDeLaOrden } from "./service-order-cells";
import "./service-order-sheet.css";

/**
 * La planilla del chofer de una salida de ruta como documento (issue #136): misma hoja de estilos,
 * mismas columnas y mismo pie que la orden de servicio y la planilla de excursiones.
 */
export function RouteSheetDocument({ sheet, assignment }: { sheet: RouteSheet; assignment?: string }) {
  return (
    <article className="orden">
      <header className="orden-cabecera">
        <div>
          <p className="orden-marca">La Araucana viajes S.R.L.</p>
          <h1 className="orden-titulo">PLANILLA DEL CHOFER</h1>
          <p className="orden-subtitulo">{sheet.routeLabel} · Nave {sheet.vehicle}</p>
          {assignment && <p className="orden-subtitulo">{assignment}</p>}
        </div>
        <div className="orden-fecha">
          <span>Fecha</span>
          <strong>{fechaDeLaOrden(sheet.date)}</strong>
          <span>Salida programada</span>
        </div>
      </header>

      {sheet.passengers.length === 0 ? (
        <section className="orden-bloque">
          <h2 className="orden-bloque-titulo">{sheet.heading}</h2>
          <p className="orden-vacia">Esta salida todavía no tiene pasajeros confirmados.</p>
        </section>
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
                      <CeldaDeLaOrden celda={celda} columna={ROUTE_SHEET_COLUMNS[indice]} />
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
