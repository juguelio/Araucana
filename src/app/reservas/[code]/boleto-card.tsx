import type { ReservationDetailDto } from "@/lib/booking/types";
import { COMPANY_CUIT_LABEL } from "@/lib/company";
import { formatDateTime, formatPrice, placesLabel } from "./presentation";

/**
 * Boleto del servicio público (#370): el comprobante que el pasajero muestra en el viaje.
 * Replica el boleto físico de La Araucana (empresa, recorrido, fecha/hora, tarifa y pie legal),
 * con el número de la serie W bien visible. No es el voucher: el voucher es la reserva.
 */
export function BoletoCard({ reservation }: { reservation: ReservationDetailDto }) {
  const boleto = reservation.serviceTicket;
  if (!boleto) return null;

  const pasajero = `${reservation.passenger.firstName} ${reservation.passenger.lastName}`.trim();
  const documento = [reservation.passenger.documentType, reservation.passenger.documentId].filter(Boolean).join(" ");
  const salida = boleto.departureAt ?? reservation.schedule.departureAt;
  const anulado = boleto.status === "ANULADO";

  return (
    <article className="boleto" data-anulado={anulado ? "si" : undefined} aria-label={`Boleto ${boleto.displayNumber}`}>
      <header className="boleto-cabecera">
        <div className="boleto-empresa">
          <p className="boleto-marca">La Araucana Viajes S.R.L.</p>
          <p className="boleto-tipo">Servicio público · Empresa de transporte</p>
          <p className="boleto-terminal">Terminal de Ómnibus de S.M. Andes · Tel. (02972) 429862</p>
        </div>
        <div className="boleto-numero">
          <span>Boleto N°</span>
          <strong>{boleto.displayNumber}</strong>
        </div>
      </header>

      <div className="boleto-recorrido">
        <div>
          <span>Origen</span>
          <strong>{boleto.origin}</strong>
        </div>
        <span className="boleto-flecha" aria-hidden="true">→</span>
        <div>
          <span>Destino</span>
          <strong>{boleto.destination}</strong>
        </div>
      </div>

      <dl className="boleto-datos">
        <div>
          <dt>Salida</dt>
          <dd>{formatDateTime(salida)}</dd>
        </div>
        <div>
          <dt>Pasajero</dt>
          <dd>{pasajero || "—"}</dd>
        </div>
        <div>
          <dt>Documento</dt>
          <dd>{documento || "—"}</dd>
        </div>
        <div>
          <dt>Lugares</dt>
          <dd>{placesLabel(reservation.passengerCount)}</dd>
        </div>
        <div>
          <dt>{reservation.passengerCount > 1 ? "Tarifa total" : "Tarifa"}</dt>
          <dd>{formatPrice(boleto.fareCents, boleto.currency)}</dd>
        </div>
        <div>
          <dt>Emitido</dt>
          <dd>{formatDateTime(boleto.issuedAt)}</dd>
        </div>
      </dl>

      <footer className="boleto-pie">
        {anulado ? (
          <strong className="boleto-anulado-texto">
            <span className="boleto-sello">Anulado</span>
            {boleto.annulReason ?? "Sin motivo registrado"}
          </strong>
        ) : (
          <span>Conservá este boleto durante el viaje. El número identifica la emisión y no se reutiliza.</span>
        )}
        <span>
          {COMPANY_CUIT_LABEL} · Inicio de actividades: 1/5/06 · Imprenta Cauitar – Hab. N° 6192
        </span>
      </footer>
    </article>
  );
}
