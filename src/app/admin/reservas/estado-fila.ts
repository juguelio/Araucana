import { canRegisterManualPayment } from "@/lib/booking/admin-price";
import { DISABILITY_DOCUMENT_PROVIDER, DISABILITY_PENDING_STATUS, receiptPendingStatus } from "@/lib/booking/disability-fare";
import type { AdminReservationRowDto } from "@/lib/booking/types";

export type TonoDeEstado = "ok" | "atencion" | "grave" | "normal";

/** La acción que se ve en la fila; el resto queda en el menú «⋯». */
export type AccionPrincipal = "validar-pago" | "aprobar-documentacion" | "registrar-pago" | "confirmar" | "whatsapp" | null;

/**
 * Texto del botón de la fila. «Confirmar» a secas se leía como si confirmara el pago —que ya está
 * acreditado cuando la reserva llega a «Pagada · sin confirmar»—, así que el botón nombra lo que
 * confirma: la reserva (el paso que habilita el voucher).
 */
const ETIQUETA_DE_ACCION: Record<Exclude<AccionPrincipal, null>, string> = {
  "validar-pago": "Validar pago",
  "aprobar-documentacion": "Revisar docs",
  "registrar-pago": "Registrar pago",
  confirmar: "Confirmar reserva",
  whatsapp: "WhatsApp"
};

export function etiquetaDeAccion(accion: AccionPrincipal): string | null {
  return accion ? ETIQUETA_DE_ACCION[accion] : null;
}


export type EstadoDeFila = {
  /** Estado y pago en una sola etiqueta: lo que hay que saber de la reserva de un vistazo. */
  etiqueta: string;
  tono: TonoDeEstado;
  accion: AccionPrincipal;
  disabilityFare: boolean;
  canViewReceipt: boolean;
  puedeRegistrarPago: boolean;
  puedeSubirComprobante: boolean;
  validaPagoManual: boolean;
  revisaDocumentacion: boolean;
  cancelada: boolean;
  pagada: boolean;
};

type Fila = Pick<
  AdminReservationRowDto,
  "status" | "paymentStatus" | "paymentProvider" | "totalCents" | "hasReceipt" | "receiptUploadedAt" | "passengerPhone"
>;

/**
 * Qué muestra y qué ofrece cada fila del listado de reservas (rediseño del 20-nov). Son las mismas
 * reglas que tenía la tabla —quién puede registrar, validar o subir un comprobante—, juntas en un
 * lugar para poder probarlas, más la etiqueta única de estado y la acción principal de la fila.
 */
export function estadoDeFila(reserva: Fila, { esAdmin }: { esAdmin: boolean }): EstadoDeFila {
  const disabilityFare = reserva.paymentProvider === DISABILITY_DOCUMENT_PROVIDER;
  const canViewReceipt = !disabilityFare || esAdmin;
  const pago = reserva.paymentProvider && reserva.paymentStatus ? { provider: reserva.paymentProvider, status: reserva.paymentStatus } : null;
  const puedeRegistrarPago = canRegisterManualPayment(reserva.status, reserva.totalCents, pago);
  // Mismas reglas que el link del pasajero: el pago tiene que estar esperando comprobante.
  const puedeSubirComprobante = Boolean(pago) && reserva.status === receiptPendingStatus(reserva.paymentProvider) &&
    ["PENDING", "REJECTED"].includes(reserva.paymentStatus ?? "") && (!disabilityFare || esAdmin);
  const validaPagoManual = !disabilityFare && reserva.hasReceipt && reserva.status === "PENDING_PAYMENT" && reserva.paymentStatus === "PENDING";
  const revisaDocumentacion = disabilityFare && canViewReceipt && reserva.hasReceipt && reserva.status === DISABILITY_PENDING_STATUS &&
    reserva.paymentStatus === "PENDING" && Boolean(reserva.receiptUploadedAt);
  const cancelada = reserva.status === "CANCELLED";
  const pagada = reserva.paymentStatus === "APPROVED" && !disabilityFare;

  let etiqueta: string;
  let tono: TonoDeEstado;
  if (cancelada) [etiqueta, tono] = ["Cancelada", "normal"];
  else if (revisaDocumentacion) [etiqueta, tono] = ["Documentación por revisar", "atencion"];
  else if (reserva.status === DISABILITY_PENDING_STATUS) [etiqueta, tono] = ["Docs pendientes", "atencion"];
  else if (validaPagoManual) [etiqueta, tono] = ["Comprobante por validar", "atencion"];
  else if (reserva.status === "PENDING_PAYMENT" && reserva.paymentStatus === "REJECTED") [etiqueta, tono] = ["Comprobante rechazado", "grave"];
  else if (reserva.status === "PENDING_PAYMENT" && pagada) [etiqueta, tono] = ["Pagada · sin confirmar", "atencion"];
  else if (reserva.status === "PENDING_PAYMENT") [etiqueta, tono] = ["Por cobrar", "atencion"];
  else if (reserva.status === "CONFIRMED" && disabilityFare) [etiqueta, tono] = ["Confirmada · sin cargo", "ok"];
  else if (reserva.status === "CONFIRMED" && pagada) [etiqueta, tono] = ["Pagada", "ok"];
  else if (reserva.status === "CONFIRMED" && reserva.totalCents > 0 && reserva.paymentStatus === "PENDING") [etiqueta, tono] = ["Confirmada · pago pendiente", "atencion"];
  else if (reserva.status === "CONFIRMED") [etiqueta, tono] = ["Confirmada", "ok"];
  else [etiqueta, tono] = [reserva.status, "normal"];

  let accion: AccionPrincipal = null;
  if (validaPagoManual) accion = "validar-pago";
  else if (revisaDocumentacion) accion = "aprobar-documentacion";
  else if (puedeRegistrarPago) accion = "registrar-pago";
  else if (reserva.status === "PENDING_PAYMENT" && pagada) accion = "confirmar";
  else if (!cancelada && reserva.passengerPhone.trim()) accion = "whatsapp";

  return { etiqueta, tono, accion, disabilityFare, canViewReceipt, puedeRegistrarPago, puedeSubirComprobante, validaPagoManual, revisaDocumentacion, cancelada, pagada };
}
