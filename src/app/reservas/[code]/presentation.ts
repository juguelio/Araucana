export function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "America/Argentina/Salta"
  }).format(new Date(value));
}

export function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(cents / 100);
}

const PAYMENT_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  APPROVED: "Pagado",
  REJECTED: "Comprobante rechazado",
  CANCELLED: "Cancelado",
  REFUNDED: "Reintegrado"
};

/** Estado del pago en castellano: antes el pasajero veía el código interno («Pending»). */
export function paymentLabel(status?: string | null) {
  if (!status) {
    return "Pendiente";
  }
  if (PAYMENT_LABELS[status]) return PAYMENT_LABELS[status];

  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Tono de la etiqueta de estado de la reserva (mismos tonos que el panel). */
export function statusTone(status?: string | null) {
  switch (status) {
    case "CONFIRMED":
      return "ok";
    case "CANCELLED":
      return "grave";
    case "PENDING_PAYMENT":
    case "DOCUMENTATION_PENDING":
      return "atencion";
    default:
      return "normal";
  }
}

export function statusBadge(status?: string | null) {
  switch (status) {
    case "CONFIRMED":
      return "Confirmada";
    case "DOCUMENTATION_PENDING":
      return "Documentación pendiente";
    case "PENDING_PAYMENT":
      return "Pago pendiente";
    case "CANCELLED":
      return "Cancelada";
    default:
      return "Recibida";
  }
}

export function statusHeading(status?: string | null) {
  switch (status) {
    case "CONFIRMED":
      return "Reserva confirmada";
    case "DOCUMENTATION_PENDING":
      return "Reserva recibida · documentación pendiente";
    case "PENDING_PAYMENT":
      return "Reserva recibida · pago pendiente";
    case "CANCELLED":
      return "Reserva cancelada";
    default:
      return "Reserva recibida";
  }
}

export function statusCopy(status?: string | null) {
  switch (status) {
    case "CONFIRMED":
      return "Tu reserva está confirmada. Conservá este enlace privado para presentarlo al equipo de Araucana.";
    case "DOCUMENTATION_PENDING":
      return "Tu viaje sin cargo queda pendiente hasta que administración apruebe el comprobante. Conservá este enlace privado para consultar el estado.";
    case "PENDING_PAYMENT":
      return "Recibimos tu reserva y el pago queda pendiente de confirmación manual. Conservá este enlace privado para coordinar el cierre con el equipo de Araucana.";
    case "CANCELLED":
      return "Esta reserva fue cancelada. Si necesitás revisar el caso, contactá al equipo de Araucana con este código.";
    default:
      return "Recibimos tu reserva. Conservá este enlace privado para consultar el estado con el equipo de Araucana.";
  }
}

export function placesLabel(passengerCount: number) {
  return `${passengerCount} ${passengerCount === 1 ? "lugar" : "lugares"}`;
}
