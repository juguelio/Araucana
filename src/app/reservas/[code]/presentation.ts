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

export function paymentLabel(status?: string | null) {
  if (!status) {
    return "Pendiente";
  }

  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
      return "Tu reserva esta confirmada. Conserva este enlace privado para presentarlo al equipo de Araucana.";
    case "DOCUMENTATION_PENDING":
      return "Tu viaje sin cargo queda pendiente hasta que administración apruebe el comprobante. Conservá este enlace privado para consultar el estado.";
    case "PENDING_PAYMENT":
      return "Recibimos tu reserva y el pago queda pendiente de confirmacion manual; conserva este enlace privado para coordinar el cierre con el equipo de Araucana.";
    case "CANCELLED":
      return "Esta reserva fue cancelada. Si necesitas revisar el caso, contacta al equipo de Araucana con este codigo.";
    default:
      return "Recibimos tu reserva. Conserva este enlace privado para consultar el estado con el equipo de Araucana.";
  }
}

export function placesLabel(passengerCount: number) {
  return `${passengerCount} ${passengerCount === 1 ? "lugar" : "lugares"}`;
}
