import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthorizationError } from "@/lib/auth/service";
import { requireReservationAccess } from "@/lib/booking/access";
import { formatShortCode } from "@/lib/booking/codes";
import { getReservationByCode } from "@/lib/booking/repository";
import {
  AGENCY_VOUCHER,
  CANCELLATION_POLICY,
  buildVoucher,
  estadoDelVoucher
} from "@/lib/booking/voucher";
import { importeDelVoucher } from "@/lib/booking/voucher";
import { PrintButton } from "./print-button";

export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export const dynamic = "force-dynamic";

type VoucherPageProps = {
  params: Promise<{ code: string }>;
};

/**
 * Voucher del pasajero (#166): el comprobante para presentar, imprimir o mandar por WhatsApp. Se abre
 * con el mismo enlace privado que la reserva —el `code` es la capability— y con el código corto sólo
 * con sesión del panel, igual que `/reservas/[code]`.
 */
export default async function VoucherPage({ params }: VoucherPageProps) {
  const { code } = await params;
  const normalized = code.toUpperCase();

  try {
    await requireReservationAccess(normalized);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return (
      <main className="page-shell section">
        <h1>Voucher privado</h1>
        <p>El voucher se abre con el enlace privado que envía La Araucana. Si lo necesitás, escribinos con tu código de reserva.</p>
        <a href="/soporte">Contactar al equipo</a>
      </main>
    );
  }

  const reservation = await getReservationByCode(normalized);
  if (!reservation) notFound();

  const voucher = buildVoucher(reservation);
  const emitido = new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Argentina/Salta"
  }).format(voucher.issuedAt);
  const cancelada = voucher.status === "CANCELLED";

  return (
    <>
      <main className="page-shell section voucher-pagina">
        <article className="voucher">
          <header className="voucher-cabecera">
            <div className="voucher-marca">
              <img className="voucher-logo" src="/logo.webp" alt={AGENCY_VOUCHER.name} />
              <div>
                <p className="voucher-empresa">{AGENCY_VOUCHER.name}</p>
                <p>{AGENCY_VOUCHER.address} · {AGENCY_VOUCHER.city}</p>
                <p>Tel {AGENCY_VOUCHER.phone} · WhatsApp {AGENCY_VOUCHER.whatsapp}</p>
                <p>{AGENCY_VOUCHER.email}</p>
              </div>
            </div>
            <div className="voucher-identidad">
              <span>Comprobante de servicios</span>
              <h1>VOUCHER</h1>
              <strong className="voucher-codigo">{formatShortCode(voucher.shortCode)}</strong>
            </div>
          </header>

          {cancelada ? (
            <p className="voucher-aviso" role="status">
              Esta reserva fue cancelada: el voucher no es válido para viajar.
            </p>
          ) : null}

          <section className="voucher-datos">
            <div><span>Pasajero</span><strong>{voucher.passengerName}</strong></div>
            <div><span>Celular</span><strong>{voucher.passengerPhone}</strong></div>
            <div><span>Documento</span><strong>{voucher.document}</strong></div>
            <div>
              <span>Lugares</span>
              <strong>{voucher.passengerCount} {voucher.passengerCount === 1 ? "pasajero" : "pasajeros"}</strong>
            </div>
            {voucher.referredBy ? <div><span>Derivado por</span><strong>{voucher.referredBy}</strong></div> : null}
            <div><span>Emitido</span><strong>{emitido}</strong></div>
            <div><span>Estado</span><strong>{estadoDelVoucher(voucher.status)}</strong></div>
          </section>

          <section className="voucher-servicios">
            <h2>Servicios</h2>
            <table className="voucher-tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Horario</th>
                  <th>Lugar de inicio</th>
                  <th>Lugar de finalización</th>
                  <th>Observaciones</th>
                </tr>
              </thead>
              <tbody>
                {voucher.rows.map((row, indice) => (
                  <tr key={indice}>
                    <td>{row.fecha}</td>
                    <td>{row.horario}</td>
                    <td>{row.inicio}</td>
                    <td>{row.fin}</td>
                    <td>{row.observaciones || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="voucher-valores">
            <h2>Valores</h2>
            {voucher.noCharge ? (
              <p className="voucher-sin-cargo">Sin cargo · tarifa por discapacidad</p>
            ) : (
              <dl>
                <div><dt>Valor total</dt><dd>{importeDelVoucher(voucher.totalCents, voucher.currency)}</dd></div>
                <div><dt>Pago registrado</dt><dd>{importeDelVoucher(voucher.paidCents, voucher.currency)}</dd></div>
                <div className="voucher-saldo"><dt>Saldo</dt><dd>{importeDelVoucher(voucher.balanceCents, voucher.currency)}</dd></div>
              </dl>
            )}
          </section>

          <section className="voucher-politicas">
            <h2>Políticas de cancelación</h2>
            <ul>
              {CANCELLATION_POLICY.map((linea) => <li key={linea}>{linea}</li>)}
            </ul>
          </section>

          <footer className="voucher-pie">
            <p>Voucher {formatShortCode(voucher.shortCode)} · Reserva {voucher.code}</p>
            <p>{AGENCY_VOUCHER.name} · {AGENCY_VOUCHER.address} · {AGENCY_VOUCHER.city}</p>
          </footer>
        </article>

        <div className="voucher-acciones no-print">
          <PrintButton />
          <Link className="ghost-button" href={`/reservas/${voucher.code}`}>Volver a la reserva</Link>
        </div>
      </main>
    </>
  );
}
