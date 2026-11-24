import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthorizationError } from "@/lib/auth/service";
import { requireReservationAccess } from "@/lib/booking/access";
import { getReservationByCode } from "@/lib/booking/repository";
import { BoletoCard } from "../boleto-card";
import { PrintButton } from "./print-button";

export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export const dynamic = "force-dynamic";

type BoletoPageProps = {
  params: Promise<{ code: string }>;
};

/**
 * Versión imprimible del boleto del servicio público.
 * Se abre con el enlace privado de la reserva; el personal del panel también entra con su sesión.
 */
export default async function BoletoPage({ params }: BoletoPageProps) {
  const { code } = await params;
  const normalized = code.toUpperCase();

  try {
    await requireReservationAccess(normalized);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return (
      <main className="page-shell section">
        <h1>Boleto privado</h1>
        <p>El boleto se abre con el enlace privado que envía La Araucana. Si lo necesitás, escribinos con tu código de reserva.</p>
        <a href="/soporte">Contactar al equipo</a>
      </main>
    );
  }

  const reservation = await getReservationByCode(normalized);
  if (!reservation) notFound();

  if (!reservation.serviceTicket) {
    return (
      <main className="page-shell section">
        <h1>Esta reserva no lleva boleto numerado</h1>
        <p>El boleto con número de serie es para el servicio público. Para traslados, excursiones y charters usá el voucher de la reserva.</p>
        <Link href={`/reservas/${normalized}`}>Volver a mi reserva</Link>
      </main>
    );
  }

  const anulado = reservation.serviceTicket.status === "ANULADO";

  return (
    <main className="page-shell section boleto-hoja">
      <div className="boleto-acciones no-print">
        <div>
          <p className="eyebrow">Boleto {reservation.serviceTicket.displayNumber}</p>
          <p>
            {anulado ? "Este boleto está anulado: no es válido para viajar." : "Podés mostrarlo desde el celular o imprimirlo."}
          </p>
        </div>
        <div className="form-actions">
          <Link className="ghost-button" href={`/reservas/${normalized}`}>
            Volver a la reserva
          </Link>
          <PrintButton />
        </div>
      </div>

      <BoletoCard reservation={reservation} />
    </main>
  );
}
