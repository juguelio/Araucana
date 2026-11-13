/**
 * Clase de la fila del listado de reservas (#108).
 *
 * El cliente pidió que la reserva cancelada se siga viendo —no se esconde del listado— pero
 * apagada en gris, para distinguirla de un vistazo sin abrir el detalle.
 */
export function reservationRowClassName(status: string) {
  return status === "CANCELLED" ? "reservas-row-cancelled" : undefined;
}
