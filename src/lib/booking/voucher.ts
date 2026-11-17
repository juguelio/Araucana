import type { ReservationDetailDto } from "./types";

/**
 * Voucher del pasajero (#166). Es el comprobante que la agencia ya entrega en Excel (`Voucher 2026.xlsx`,
 * el que mandó el cliente) pero armado con la reserva real: sirve para mostrarlo desde el celular,
 * imprimirlo o mandarlo por WhatsApp desde el panel.
 *
 * El documento no inventa datos: los valores salen de la reserva (total y pago registrado) y el texto de
 * las políticas es el del ejemplo del cliente, literal. Lo único que la app no tiene es la seña como
 * concepto aparte: se muestra «pago registrado» y el saldo que queda.
 */

/** Datos fijos del comprobante, los mismos del encabezado del voucher de la agencia. */
export const AGENCY_VOUCHER = {
  name: "La Araucana Viajes S.R.L.",
  address: "Mariano Moreno 829 — C.P. 8370",
  city: "San Martín de los Andes, Neuquén",
  phone: "(02972) 420-285",
  whatsapp: "+54 9 2944 649049",
  email: "info@araucana.com.ar"
} as const;

/**
 * Políticas de cancelación del voucher, copiadas del ejemplo que mandó el cliente (16-nov-2026).
 * Van en código y no en la base porque son el texto del comprobante, no un parámetro de operación:
 * si la agencia cambia los porcentajes, se cambian acá. Editarlas desde el panel queda como etapa 2.
 */
export const CANCELLATION_POLICY: readonly string[] = [
  "Válido exclusivamente para la fecha y los servicios determinados. Su entrega es imprescindible para la obtención de los servicios. La empresa se reserva el derecho de condicionar las salidas y/o modificar los recorridos acordados por: factores climáticos, cortes de ruta, rutas intransitables o cualquier otra circunstancia ajena a la empresa.",
  "Cancelación del servicio hasta 48 horas antes de la realización del mismo: se reintegrará el 90% del valor abonado.",
  "Cancelación del servicio hasta 24 horas antes de la realización del mismo: se reintegrará el 80% del valor abonado.",
  "Cancelación del servicio hasta 12 horas antes de la realización del mismo: se reintegrará el 50% del valor abonado.",
  "Cancelación con menos de 12 horas de anticipación: no tiene reintegros.",
  "En caso de no apertura del Centro de Esquí se les entregará voucher con saldo a favor para utilizarlo nuevamente en compras futuras."
];

const ZONA_ARGENTINA = "America/Argentina/Salta";
const AEROPUERTO = "Aeropuerto Chapelco (CPC)";
const CERRO = "Cerro Chapelco";

const dosDigitos = (valor: number) => String(valor).padStart(2, "0");

/**
 * Fecha de calendario (`DATE` guardada a las 00:00Z): se lee en UTC. Formatearla en hora argentina la
 * corre al día anterior — el 1.º de febrero se imprimiría «31 de enero».
 */
export function diaCalendario(valor: Date | string) {
  const fecha = new Date(valor);
  return `${dosDigitos(fecha.getUTCDate())}/${dosDigitos(fecha.getUTCMonth() + 1)}/${fecha.getUTCFullYear()}`;
}

/** Instantes (salida de una ruta, horario de vuelo): en hora argentina. */
export function fechaArgentina(valor: Date | string) {
  const fecha = new Date(valor);
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: ZONA_ARGENTINA
  }).format(fecha);
}

export function horaArgentina(valor: Date | string) {
  const fecha = new Date(valor);
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: ZONA_ARGENTINA
  }).format(fecha);
}

export type VoucherRow = {
  /** «Llegada» / «Salida» en el traslado de aeropuerto; `null` en los demás servicios. */
  tramo?: "Llegada" | "Salida" | null;
  fecha: string;
  horario: string;
  inicio: string;
  fin: string;
  observaciones: string;
};

/** El otro tramo del ida y vuelta: lo que el pasajero necesita para saber que existe y cómo abrirlo. */
export type VoucherRoundTrip = {
  code: string;
  shortCode: string;
  /** Estado del otro tramo, ya en el idioma del comprobante («Confirmada», «Cancelada»…). */
  estado: string;
};

export type VoucherData = {
  passengerName: string;
  passengerPhone: string;
  document: string;
  passengerCount: number;
  /** Quién derivó la venta (agencia, voucher). `null` cuando la venta fue directa. */
  referredBy: string | null;
  code: string;
  shortCode: string;
  rows: VoucherRow[];
  /** Ida y vuelta (#205): el otro tramo del viaje, cuando la reserva tiene compañero. */
  roundTrip: VoucherRoundTrip | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  currency: string;
  status: string;
  issuedAt: Date;
  /** Reserva sin cargo (tarifa por discapacidad): no se muestran importes. */
  noCharge: boolean;
};

/**
 * Documento del pasajero para el comprobante. Las reservas cargadas antes de que el DNI fuera
 * obligatorio (13/11/2026) lo tienen vacío: imprimir la etiqueta sola («DNI») se lee como un dato
 * truncado, no como un dato faltante, así que va «—» (#170).
 */
export function documentoDelPasajero(passenger: { documentType: string; documentId: string }) {
  const id = (passenger.documentId ?? "").trim();
  if (!id) return "—";
  const tipo = (passenger.documentType ?? "").trim();
  return tipo ? `${tipo} ${id}` : id;
}

/** Prefijo del proveedor de pago que representa la tarifa sin cargo por discapacidad. */
const PROVEEDOR_SIN_CARGO = "disability_document";

/**
 * Arma el voucher desde la reserva. Un renglón de servicio por tramo: en el ida y vuelta del
 * aeropuerto son **dos** reservas que comparten `roundTripId` (#36), y el voucher de una mostraba
 * sólo su mitad — el pasajero de ida no veía la vuelta (#205). Cuando llega el compañero del viaje,
 * van las dos filas ordenadas por fecha y hora, y los importes siguen siendo los de la reserva
 * abierta (cada tramo se abona y se cancela por separado).
 */
export function buildVoucher(
  reservation: ReservationDetailDto,
  options: { partner?: ReservationDetailDto | null; now?: Date } = {}
): VoucherData {
  const propio = filaDelServicio(reservation);
  const otro = options.partner ? filaDelServicio(options.partner) : null;

  if (otro && options.partner) {
    // El renglón del otro tramo dice de qué reserva es: el pasajero necesita su código para abrir
    // ese voucher (o pedirlo) sin confundirlo con el que tiene en la mano.
    otro.fila.observaciones = [otro.fila.observaciones, `Reserva ${options.partner.shortCode}`]
      .filter(Boolean)
      .join(" · ");
  }

  const filas = otro ? [propio, otro].sort((a, b) => a.orden - b.orden) : [propio];

  const noCharge = reservation.payment?.provider === PROVEEDOR_SIN_CARGO;
  const pagado = reservation.payment?.status === "APPROVED" ? reservation.payment.amountCents : 0;
  const totalCents = noCharge ? 0 : reservation.totalCents;
  const paidCents = noCharge ? 0 : Math.min(pagado, totalCents);

  return {
    passengerName: `${reservation.passenger.firstName} ${reservation.passenger.lastName}`.trim(),
    passengerPhone: reservation.passenger.phone,
    document: documentoDelPasajero(reservation.passenger),
    passengerCount: reservation.passengerCount,
    referredBy: reservation.referredBy ?? null,
    code: reservation.code,
    shortCode: reservation.shortCode,
    rows: filas.map(({ fila }) => fila),
    roundTrip: options.partner
      ? {
          code: options.partner.code,
          shortCode: options.partner.shortCode,
          estado: estadoDelVoucher(options.partner.status)
        }
      : null,
    totalCents,
    paidCents,
    balanceCents: Math.max(totalCents - paidCents, 0),
    currency: reservation.currency,
    status: reservation.status,
    issuedAt: options.now ?? new Date(),
    noCharge
  };
}

type FilaArmada = {
  fila: VoucherRow;
  /** Instante del servicio: ordena los tramos del viaje (no la fecha en que se cargó la reserva). */
  orden: number;
};

/** Un renglón de servicio de UNA reserva: fecha, horario, dónde empieza y dónde termina. */
function filaDelServicio(reservation: ReservationDetailDto): FilaArmada {
  const airport = reservation.bookingMode === "AIRPORT" ? reservation.airportDetails ?? null : null;
  const chapelco = reservation.bookingMode === "CHAPELCO" ? reservation.chapelcoDetails ?? null : null;

  let fecha: string;
  let horario: string;
  let inicio: string;
  let fin: string;
  let tramo: VoucherRow["tramo"] = null;
  let orden: number;
  const notas: string[] = [];

  if (airport) {
    const vuelo = airport.flight ?? null;
    if (vuelo?.scheduledAt) {
      fecha = fechaArgentina(vuelo.scheduledAt);
      horario = horaArgentina(vuelo.scheduledAt);
      orden = new Date(vuelo.scheduledAt).getTime();
    } else {
      fecha = diaCalendario(airport.serviceDate);
      horario = "A confirmar";
      orden = new Date(airport.serviceDate).getTime();
    }
    tramo = airport.direction === "ARRIVAL" ? "Llegada" : "Salida";
    const direccion = airport.pickupAddress ?? null;
    const saleDelAeropuerto = airport.direction === "ARRIVAL";
    inicio = saleDelAeropuerto ? AEROPUERTO : direccion ?? AEROPUERTO;
    fin = saleDelAeropuerto ? direccion ?? "San Martín de los Andes" : AEROPUERTO;
    notas.push(tramo);
    notas.push(`Vuelo ${airport.flightNumber}`);
    if (airport.pickupName) notas.push(airport.pickupName);
    if (airport.pickupNotes) notas.push(airport.pickupNotes);
  } else if (chapelco) {
    fecha = diaCalendario(chapelco.serviceDate);
    horario = chapelco.ascentSlot;
    inicio = `${chapelco.pickupName} — ${chapelco.pickupAddress}`;
    fin = CERRO;
    orden = new Date(chapelco.serviceDate).getTime();
    notas.push(`Regreso incluido desde las 17:00`);
    if (chapelco.pickupNotes) notas.push(chapelco.pickupNotes);
  } else {
    const salida = reservation.schedule.departureAt;
    fecha = salida ? fechaArgentina(salida) : "A confirmar";
    horario = salida ? horaArgentina(salida) : "A confirmar";
    inicio = reservation.route.from;
    fin = reservation.dropoffStop ?? reservation.route.to;
    orden = salida ? new Date(salida).getTime() : new Date(reservation.createdAt).getTime();
  }

  if (reservation.status === "CANCELLED") notas.push("Cancelado");

  return {
    fila: { tramo, fecha, horario, inicio, fin, observaciones: notas.filter(Boolean).join(" · ") },
    orden
  };
}

/**
 * Importe del voucher con el código de moneda. El comprobante circula fuera de la app —se manda por
 * WhatsApp y se imprime— y `$ 12.000` no dice en qué moneda está: el símbolo `$` se lee igual en
 * Argentina, Chile y México, y el voucher viaja a pasajeros extranjeros.
 */
export function importeDelVoucher(cents: number, currency: string) {
  const codigo = /^[A-Z]{3}$/.test(currency) ? currency : "ARS";
  const numero = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: codigo,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(cents / 100);
  return `${numero} ${codigo}`;
}

/** Ruta del voucher: se abre con el mismo `code` privado que la reserva. */
export function voucherPath(code: string) {
  return `/reservas/${code}/voucher`;
}

/** Cómo se lee el estado de la reserva en el comprobante. */
export function estadoDelVoucher(status: string) {
  const etiquetas: Record<string, string> = {
    CONFIRMED: "Confirmada",
    PENDING_PAYMENT: "Pago pendiente",
    DOCUMENTATION_PENDING: "Documentación pendiente",
    CANCELLED: "Cancelada"
  };
  return etiquetas[status] ?? status;
}

/** Link absoluto, para el mensaje de WhatsApp (el pasajero lo abre fuera de la app). */
export function absoluteUrl(path: string, origin: string) {
  return new URL(path, origin.endsWith("/") ? origin : `${origin}/`).toString();
}

/**
 * Mensaje con el que el operador manda el voucher desde el panel. Es un texto corto y editable: el
 * operador lo puede completar en WhatsApp antes de enviarlo.
 */
export function voucherMessage(input: { firstName?: string | null; shortCode: string; url: string }) {
  const saludo = input.firstName ? `Hola ${input.firstName}, ` : "Hola, ";
  return [
    `${saludo}te enviamos el voucher de tu reserva ${input.shortCode} de La Araucana Viajes.`,
    "",
    input.url,
    "",
    "Podés mostrarlo desde el celular o imprimirlo. Ahí están las políticas de cancelación."
  ].join("\n");
}

/** `wa.me` del pasajero con el mensaje ya escrito; `null` si no hay teléfono cargado. */
export function whatsappShareUrl(phone: string | null | undefined, message: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null;
}
