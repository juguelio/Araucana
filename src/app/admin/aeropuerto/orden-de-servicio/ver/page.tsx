import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { getAirportServiceOrderReservations } from "@/lib/airport/service-order-repository";
import {
  blockTimeLabel,
  buildServiceOrderBlocks,
  fechaDeLaOrden,
  plata,
  SERVICE_ORDER_COLUMNS,
  serviceOrderRow
} from "@/lib/airport/service-order";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import { ImprimirButton } from "./imprimir-button";
import "./orden-de-servicio.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Orden de servicio · La Araucana Viajes",
  robots: { index: false, follow: false }
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type VerOrdenPageProps = {
  searchParams?: Promise<{ date?: string; flight?: string }>;
};

/** Hoy en San Martín de los Andes, como `YYYY-MM-DD` (mismo criterio que la descarga del .xlsx). */
function diaDeHoy() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Salta" }).format(new Date());
}

/**
 * La orden de servicio en pantalla: la misma hoja que se baja en .xlsx, con las mismas columnas y los
 * mismos bloques por vuelo (issue #118).
 *
 * Sirve para tres cosas que el archivo no resolvía:
 *  - verla sin descargar nada, en una pestaña aparte;
 *  - imprimirla desde el navegador, con el formato del papel;
 *  - corregir un dato (DNI, alojamiento, contacto, «derivado por», pago) desde la fila: el link lleva a
 *    la ficha de la reserva, que es la única fuente de estos datos. Al volver, la hoja ya sale corregida.
 */
export default async function VerOrdenDeServicioPage({ searchParams }: VerOrdenPageProps) {
  await getCurrentReservationsUserOrRedirect();
  const params = await searchParams;
  const date = params?.date ?? diaDeHoy();
  const flightId = params?.flight || null;

  if (!DATE_PATTERN.test(date)) {
    notFound();
  }

  const blocks = buildServiceOrderBlocks(await getAirportServiceOrderReservations(date, flightId));
  const totalDelDia = blocks.reduce((suma, bloque) => suma + bloque.totalCents, 0);
  const totalPasajeros = blocks.reduce((suma, bloque) => suma + bloque.passengers.reduce((n, p) => n + p.seats, 0), 0);
  const currency = blocks[0]?.passengers[0]?.currency ?? "ARS";
  const excelHref = `/admin/aeropuerto/orden-de-servicio?date=${encodeURIComponent(date)}${flightId ? `&flight=${encodeURIComponent(flightId)}` : ""}`;

  return (
    <AdminShell
      title="Orden de servicio"
      eyebrow="Operación"
      action={
        <div className="form-actions no-print">
          <ImprimirButton />
          <a className="ghost-button" href={excelHref}>Descargar Excel</a>
          <Link className="ghost-button" href={`/admin/aeropuerto?date=${encodeURIComponent(date)}`}>Volver a aeropuerto</Link>
        </div>
      }
    >
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
            <span>{flightId ? "Un vuelo" : "Día completo"}</span>
          </div>
        </header>

        {blocks.length === 0 ? (
          <p className="orden-vacia">
            No hay reservas de aeropuerto para ese día. Probá con otra fecha desde el panel de aeropuerto.
          </p>
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
                    <th className="orden-acciones no-print">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {block.passengers.map((pasajero) => (
                    <tr key={pasajero.code}>
                      {serviceOrderRow(pasajero).map((celda, indice) => (
                        <td key={`${pasajero.code}-${indice}`} data-columna={SERVICE_ORDER_COLUMNS[indice]}>
                          {celda || <span className="orden-vacio">—</span>}
                        </td>
                      ))}
                      <td className="orden-acciones no-print">
                        <Link href={`/admin/reservas/${pasajero.code}/editar`}>Editar</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={SERVICE_ORDER_COLUMNS.length - 1}>Total {block.heading} {block.flightNumber}</td>
                    <td>{plata(block.totalCents, currency)}</td>
                    <td className="no-print" />
                  </tr>
                </tfoot>
              </table>
            </section>
          ))
        )}

        {blocks.length > 0 ? (
          <footer className="orden-total">
            <span>{totalPasajeros} pasajero(s) · {blocks.length} bloque(s)</span>
            <strong>TOTAL DEL DÍA {plata(totalDelDia, currency)}</strong>
          </footer>
        ) : null}

        <p className="orden-pie">
          «Derivado por» es el origen que se cargó en la reserva (agencia o voucher); si la venta fue directa, va vacío.
          El detalle del pago se completa con la reserva. Cobrar / Pagado es el estado del pago.
        </p>
      </article>
    </AdminShell>
  );
}
