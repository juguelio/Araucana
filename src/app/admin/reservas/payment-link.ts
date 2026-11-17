import { canRegisterManualPayment } from "@/lib/booking/admin-price";
import { DISABILITY_DOCUMENT_PROVIDER } from "@/lib/booking/disability-fare";

/**
 * ¿La etiqueta «Pago pendiente» del listado lleva a registrar el pago? (#210)
 *
 * El cliente cobra por transferencia y pidió entrar desde la etiqueta: la columna Acciones ya no
 * tiene lugar para otro botón. Para no ofrecer un link que la pantalla «Registrar pago» rechace,
 * la condición es la misma que usa esa pantalla (`canRegisterManualPayment`), más el rótulo: sólo
 * la etiqueta que dice «Pago pendiente», que es la que el operador nombra.
 *
 * Una reserva sin cargo por discapacidad nunca lleva el link: no hay nada que cobrar.
 */
export function enlaceRegistrarPago(reserva: {
  status: string;
  paymentStatus: string | null;
  paymentProvider?: string | null;
  totalCents: number;
}) {
  if (reserva.status !== "PENDING_PAYMENT") return false;
  if (reserva.paymentProvider === DISABILITY_DOCUMENT_PROVIDER) return false;
  const pago = reserva.paymentStatus ? { provider: reserva.paymentProvider ?? "", status: reserva.paymentStatus } : null;
  return canRegisterManualPayment(reserva.status, reserva.totalCents, pago);
}
