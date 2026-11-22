import { DISABILITY_DOCUMENT_PROVIDER, receiptPendingStatus } from "@/lib/booking/disability-fare";

/**
 * Qué se puede hacer con el comprobante de una reserva. Es la regla única: la usan el listado, la
 * ficha, la pantalla de editar y el guard del servidor, para que la pantalla no ofrezca algo que el
 * backend rechaza (y al revés).
 *
 * - `subir`: no hay archivo y el pago todavía espera comprobante.
 * - `reemplazar`: hay archivo y el pago todavía espera revisión.
 * - `adjuntar`: el pago ya se registró (aprobado) sin el archivo y el comprobante de la
 *   transferencia aparece después. Se guarda como respaldo sin reabrir la validación: el estado
 *   del pago no cambia y la auditoría registra quién lo subió y cuándo.
 * - `bloqueado`: no corresponde (sin pago, comprobante ya validado, reserva cancelada).
 */
export type PoliticaDeComprobante = "subir" | "reemplazar" | "adjuntar" | "bloqueado";

export type PagoParaComprobante = { provider: string; status: string; hasReceipt: boolean };

const ESPERA_REVISION = ["PENDING", "REJECTED"];
/** Estados en los que la plata ya está registrada: el comprobante se adjunta como respaldo. */
const PAGADA = ["PENDING_PAYMENT", "CONFIRMED"];

export function politicaDeComprobante(status: string, payment: PagoParaComprobante | null | undefined): PoliticaDeComprobante {
  if (!payment) return "bloqueado";
  if (status === "CANCELLED") return "bloqueado";
  const esperaRevision = ESPERA_REVISION.includes(payment.status);

  if (payment.provider === DISABILITY_DOCUMENT_PROVIDER) {
    if (status !== receiptPendingStatus(payment.provider) || !esperaRevision) return "bloqueado";
    return payment.hasReceipt ? "reemplazar" : "subir";
  }

  if (payment.provider !== "MANUAL") return "bloqueado";
  if (status === receiptPendingStatus("MANUAL") && esperaRevision) {
    return payment.hasReceipt ? "reemplazar" : "subir";
  }
  // Registrar el pago manual lo deja aprobado de una y el comprobante de la transferencia puede
  // llegar después (el cliente lo manda por WhatsApp). Adjuntarlo no toca el estado del pago ni el
  // monto; reemplazar uno ya validado sí cambia la evidencia de una aprobación, así que sigue cerrado.
  if (payment.status === "APPROVED" && !payment.hasReceipt && PAGADA.includes(status)) return "adjuntar";
  return "bloqueado";
}
