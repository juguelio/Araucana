import { claveDeLugar } from "./place-names";
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
const CIUDAD = "San Martín de los Andes";

/**
 * De dónde sale cada servicio regular (19-nov). Los micros de las rutas salen de la **terminal** de
 * cada localidad, no del «centro»: el voucher es lo que muestra el pasajero para saber dónde esperar.
 * Lo que no es una de estas tres localidades se imprime tal cual (Hua Hum, Yuco, la terminal de
 * ómnibus de otra ciudad o un domicilio).
 */
const TERMINALES: Record<string, string> = {
  "san martin de los andes": "Terminal de Ómnibus de San Martín de los Andes",
  "s. m. andes": "Terminal de Ómnibus de San Martín de los Andes",
  "villa traful": "Terminal de Ómnibus de Villa Traful",
  "villa la angostura": "Terminal de Ómnibus de Villa La Angostura"
};

/** El lugar de salida que va impreso en el voucher: la terminal de la localidad, si la conocemos. */
export function lugarDeSalida(lugar: string | null | undefined) {
  const nombre = (lugar ?? "").trim();
  if (!nombre) return "";
  return TERMINALES[claveDeLugar(nombre)] ?? nombre;
}

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
  fecha: string;
  horario: string;
  inicio: string;
  fin: string;
  observaciones: string;
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
  /** Código corto del otro tramo del ida y vuelta, para que el pasajero tenga los dos a mano. */
  partnerShortCode: string | null;
  rows: VoucherRow[];
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

/** Un renglón de la tabla del voucher para un traslado al aeropuerto. */
function filaDelAeropuerto(airport: {
  direction?: string | null;
  flightNumber: string;
  serviceDate: Date | string;
  pickupName?: string | null;
  pickupAddress?: string | null;
  pickupNotes?: string | null;
  flight?: { scheduledAt: Date | string } | null;
}): VoucherRow {
  const vuelo = airport.flight ?? null;
  const fecha = vuelo?.scheduledAt ? fechaArgentina(vuelo.scheduledAt) : diaCalendario(airport.serviceDate);
  const horario = vuelo?.scheduledAt ? horaArgentina(vuelo.scheduledAt) : "A confirmar";
  const direccion = airport.pickupAddress ?? null;
  const saleDelAeropuerto = airport.direction === "ARRIVAL";
  // Sin dirección cargada, la partida sale «de San Martín de los Andes», no del aeropuerto: si no, el
  // voucher decía «Aeropuerto → Aeropuerto» y la vuelta parecía otro traslado.
  const inicio = saleDelAeropuerto ? AEROPUERTO : direccion ?? CIUDAD;
  const fin = saleDelAeropuerto ? direccion ?? CIUDAD : AEROPUERTO;

  const notas: string[] = [`Vuelo ${airport.flightNumber}`];
  if (airport.pickupName) notas.push(airport.pickupName);
  if (airport.pickupNotes) notas.push(airport.pickupNotes);

  return { fecha, horario, inicio, fin, observaciones: notas.filter(Boolean).join(" · ") };
}

/**
 * Arma el voucher desde la reserva. Un traslado al aeropuerto es un renglón; en el ida y vuelta se
 * suman los dos servicios en la misma tabla (#166), con la vuelta debajo de la ida.
 */
export function buildVoucher(reservation: ReservationDetailDto, now = new Date()): VoucherData {
  const airport = reservation.bookingMode === "AIRPORT" ? reservation.airportDetails ?? null : null;
  const chapelco = reservation.bookingMode === "CHAPELCO" ? reservation.chapelcoDetails ?? null : null;

  const rows: VoucherRow[] = [];

  // El otro tramo del ida y vuelta, salvo que se haya cancelado: entonces el voucher es sólo de éste.
  const socio =
    reservation.roundTripPartner && reservation.roundTripPartner.status !== "CANCELLED" ? reservation.roundTripPartner : null;

  if (airport) {
    const vuelta = socio?.airport ?? null;
    // Ida y vuelta: el comprobante tiene que mostrar también la vuelta, no sólo el tramo que se abrió.
    // Se ordenan como el viaje —la llegada primero, la salida después— sin importar cuál se abrió.
    const tramos = vuelta ? [airport, vuelta] : [airport];
    tramos.sort((a, b) => Number(b.direction === "ARRIVAL") - Number(a.direction === "ARRIVAL"));
    rows.push(...tramos.map(filaDelAeropuerto));
  } else if (chapelco) {
    const notas = [`Regreso incluido desde las 17:00`];
    if (chapelco.pickupNotes) notas.push(chapelco.pickupNotes);
    rows.push({
      fecha: diaCalendario(chapelco.serviceDate),
      horario: chapelco.ascentSlot,
      inicio: `${chapelco.pickupName} — ${chapelco.pickupAddress}`,
      fin: CERRO,
      observaciones: notas.filter(Boolean).join(" · ")
    });
  } else {
    const salida = reservation.schedule.departureAt;
    rows.push({
      fecha: salida ? fechaArgentina(salida) : "A confirmar",
      horario: salida ? horaArgentina(salida) : "A confirmar",
      inicio: lugarDeSalida(reservation.route.from),
      fin: reservation.dropoffStop ?? reservation.route.to,
      observaciones: ""
    });
  }

  // Ida y vuelta: cada tramo es una reserva con su importe y su pago, pero el pasajero compró un viaje.
  // El voucher suma los dos, así no muestra la mitad del valor ni la mitad de lo pagado.
  const conImporte = airport && socio?.airport && typeof socio.totalCents === "number";
  const tramosCobrados = [
    { totalCents: reservation.totalCents, payment: reservation.payment ?? null },
    ...(conImporte ? [{ totalCents: socio.totalCents as number, payment: socio.payment ?? null }] : [])
  ];
  const noCharge = tramosCobrados.every((tramo) => tramo.payment?.provider === PROVEEDOR_SIN_CARGO);
  const totalCents = noCharge
    ? 0
    : tramosCobrados.reduce((suma, tramo) => suma + (tramo.payment?.provider === PROVEEDOR_SIN_CARGO ? 0 : tramo.totalCents), 0);
  const pagado = tramosCobrados.reduce(
    (suma, tramo) =>
      suma + (tramo.payment?.status === "APPROVED" && tramo.payment.provider !== PROVEEDOR_SIN_CARGO ? tramo.payment.amountCents : 0),
    0
  );
  const paidCents = noCharge ? 0 : Math.min(pagado, totalCents);

  return {
    passengerName: `${reservation.passenger.firstName} ${reservation.passenger.lastName}`.trim(),
    passengerPhone: reservation.passenger.phone,
    document: documentoDelPasajero(reservation.passenger),
    passengerCount: reservation.passengerCount,
    referredBy: reservation.referredBy ?? null,
    code: reservation.code,
    shortCode: reservation.shortCode,
    partnerShortCode: airport && socio ? socio.shortCode : null,
    rows,
    totalCents,
    paidCents,
    balanceCents: Math.max(totalCents - paidCents, 0),
    currency: reservation.currency,
    status: reservation.status,
    issuedAt: now,
    noCharge
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
