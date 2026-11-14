import ExcelJS from "exceljs";
import {
  documentoDelPasajero,
  fechaDeLaOrden,
  horaEnSalta,
  paymentLabel,
  plata
} from "@/lib/airport/service-order";
import { ordenarPorRecorrido, whatsappLink, type PickupCoords } from "@/lib/airport/route-order";

/**
 * Planilla del chofer de una salida programada de ruta (issue #136).
 *
 * Es el tercer modo que faltaba: aeropuerto ya tiene la orden de servicio (#118) y las excursiones
 * tienen su planilla (#110). Acá la hoja es de **una salida** (`Schedule`), no de un día completo:
 * la combi de las 09:00 lleva su propia lista, con el mismo papel que las otras dos —un renglón por
 * reserva, «Derivado por», el estado del pago y el contacto como link de WhatsApp.
 */

/** Parada de la ruta tal como la guarda el editor (`stops` es JSON). */
export type RouteSheetStop = {
  name: string;
  minutes: number | null;
  /** Coordenadas opcionales: hoy el editor no las guarda, pero si están se usa el recorrido. */
  latitude: number | null;
  longitude: number | null;
};

export type RouteSheetReservationInput = {
  /** Código del ticket: lo que puede ver el chofer. El `code` de la reserva es el link privado. */
  ticketCode: string | null;
  passengerCount: number;
  dropoffStop: string | null;
  referredBy: string | null;
  totalCents: number;
  currency: string;
  /** Estado del pago (`Payment.status`); `null` cuando todavía no hay pago asociado. */
  paymentStatus: string | null;
  passenger: {
    firstName: string;
    lastName: string;
    documentType: string;
    documentId: string;
    phone: string;
    email: string;
  };
};

export type RouteSheetInput = {
  scheduleId: string;
  departureAt: Date;
  arrivalAt: Date;
  status: string;
  route: { from: string; to: string; via: string; stops: unknown };
  vehicle: { name: string; licensePlate: string | null };
  reservations: RouteSheetReservationInput[];
};

export type RouteSheetPassenger = {
  code: string;
  name: string;
  seats: number;
  document: string;
  /** Parada que tiene cargada la reserva; vacío cuando viaja hasta el final de la ruta. */
  stop: string;
  referredBy: string | null;
  payment: string;
  amountCents: number;
  currency: string;
  contact: string;
};

export type RouteSheet = {
  scheduleId: string;
  date: string;
  routeLabel: string;
  heading: string;
  departureAt: Date;
  arrivalAt: Date;
  vehicle: string;
  passengers: RouteSheetPassenger[];
  totalCents: number;
  currency: string;
  totalSeats: number;
};

export const ROUTE_SHEET_COLUMNS = ["Pasajero", "Cant", "DNI", "Parada", "Derivado por", "Pago", "Contacto"] as const;

/** Una fila de la tabla, en el mismo orden que `ROUTE_SHEET_COLUMNS`. */
export function routeSheetRow(passenger: RouteSheetPassenger): string[] {
  return [
    passenger.name,
    String(passenger.seats),
    passenger.document,
    passenger.stop,
    passenger.referredBy ?? "",
    passenger.payment,
    passenger.contact
  ];
}

/** `stops` es JSON libre: se normaliza sin inventar paradas ni coordenadas. */
export function normalizeRouteSheetStops(stops: unknown): RouteSheetStop[] {
  if (!Array.isArray(stops)) return [];

  return stops
    .map((stop) => {
      if (!stop || typeof stop !== "object") return null;
      const record = stop as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (!name) return null;
      const minutes = typeof record.minutes === "number" && Number.isFinite(record.minutes) ? record.minutes : null;
      const latitude = typeof record.latitude === "number" && Number.isFinite(record.latitude) ? record.latitude : null;
      const longitude = typeof record.longitude === "number" && Number.isFinite(record.longitude) ? record.longitude : null;
      return { name, minutes, latitude, longitude };
    })
    .filter((stop): stop is RouteSheetStop => Boolean(stop));
}

const coordenadasDeLaParada = (stop: RouteSheetStop): PickupCoords | null =>
  stop.latitude !== null && stop.longitude !== null
    ? { latitude: stop.latitude, longitude: stop.longitude }
    : null;

/**
 * Orden de las filas para el chofer.
 *
 * - Si las paradas tienen coordenadas, se encadena el recorrido con `ordenarPorRecorrido` (el mismo
 *   criterio que la hoja del aeropuerto).
 * - Si no —el caso de hoy: el editor de paradas guarda nombre, minutos y nota, sin lat/lng— el orden
 *   es la secuencia de paradas de la ruta, que es la que el chofer recorre igual.
 * - La reserva sin parada cargada (viaja hasta el final) va al final, sin inventarle una ubicación.
 */
export function routeSheetOrder(passengers: RouteSheetPassenger[], stops: RouteSheetStop[]): RouteSheetPassenger[] {
  const conCoordenadas = stops.filter((stop) => coordenadasDeLaParada(stop) !== null);
  const rango = new Map<string, number>();

  if (conCoordenadas.length >= 2) {
    ordenarPorRecorrido(conCoordenadas, coordenadasDeLaParada).forEach((stop, indice) => {
      rango.set(stop.name.toLowerCase(), indice);
    });
  } else {
    stops.forEach((stop, indice) => {
      rango.set(stop.name.toLowerCase(), indice);
    });
  }

  const posicion = (passenger: RouteSheetPassenger) =>
    passenger.stop ? rango.get(passenger.stop.trim().toLowerCase()) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;

  return [...passengers].sort((a, b) => {
    const diferencia = posicion(a) - posicion(b);
    if (diferencia !== 0) return diferencia;
    return a.name.localeCompare(b.name, "es");
  });
}

/** `YYYY-MM-DD` de la salida, leído en hora argentina: un instante, no una fecha de calendario. */
function diaDeLaSalida(departureAt: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Salta" }).format(departureAt);
}

export function buildRouteSheet(input: RouteSheetInput): RouteSheet {
  const stops = normalizeRouteSheetStops(input.route.stops);
  const currency = input.reservations[0]?.currency ?? "ARS";

  const passengers = input.reservations.map((reservation) => ({
    // El código del ticket es lo que el chofer puede ver; el `code` de la reserva es el link privado
    // del pasajero y no se imprime en una hoja que se pasa de mano.
    code: reservation.ticketCode ?? "Sin ticket",
    name: `${reservation.passenger.firstName} ${reservation.passenger.lastName}`.trim(),
    seats: reservation.passengerCount,
    document: documentoDelPasajero(reservation.passenger.documentType, reservation.passenger.documentId),
    stop: reservation.dropoffStop?.trim() || "",
    referredBy: reservation.referredBy?.trim() ? reservation.referredBy.trim() : null,
    payment: paymentLabel(reservation.paymentStatus, reservation.totalCents, reservation.currency),
    amountCents: reservation.totalCents,
    currency: reservation.currency,
    contact: reservation.passenger.phone || reservation.passenger.email
  }));

  const routeLabel = `${input.route.from} → ${input.route.to}`;

  return {
    scheduleId: input.scheduleId,
    date: diaDeLaSalida(input.departureAt),
    routeLabel,
    heading: `${routeLabel} · sale ${horaEnSalta(input.departureAt)} · llega ${horaEnSalta(input.arrivalAt)}`,
    departureAt: input.departureAt,
    arrivalAt: input.arrivalAt,
    vehicle: input.vehicle.licensePlate
      ? `${input.vehicle.name} (${input.vehicle.licensePlate})`
      : input.vehicle.name,
    passengers: routeSheetOrder(passengers, stops),
    totalCents: input.reservations.reduce((suma, reservation) => suma + reservation.totalCents, 0),
    currency,
    totalSeats: passengers.reduce((suma, passenger) => suma + passenger.seats, 0)
  };
}

function slug(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export function routeSheetFileName(sheet: Pick<RouteSheet, "date" | "routeLabel">) {
  return `planilla-salida-${slug(sheet.routeLabel)}-${sheet.date}.xlsx`;
}

const VERDE = "FF0B4F3F";
const VERDE_SUAVE = "FFE8F0EC";
const ANCHOS = [30, 6, 16, 26, 22, 18, 26];

/**
 * El .xlsx de la salida, con la forma del papel: banda de la salida, encabezado y una fila por
 * reserva, con el total. Una salida sin pasajeros se entrega vacía con el aviso, no falla.
 */
export async function buildRouteSheetWorkbook(
  sheet: RouteSheet,
  meta: { generatedAt: Date }
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "La Araucana Viajes";
  workbook.created = meta.generatedAt;
  workbook.modified = meta.generatedAt;

  const page = workbook.addWorksheet("Planilla de la salida", {
    views: [{ state: "frozen", ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  page.columns = ANCHOS.map((width) => ({ width }));

  page.mergeCells("A1:G3");
  const titulo = page.getCell("A1");
  titulo.value = "La Araucana viajes S.R.L.";
  titulo.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  titulo.alignment = { vertical: "middle" };
  for (let fila = 1; fila <= 3; fila += 1) {
    for (let columna = 1; columna <= ROUTE_SHEET_COLUMNS.length; columna += 1) {
      page.getCell(fila, columna).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
    }
  }

  page.mergeCells("A4:G4");
  const subtitulo = page.getCell("A4");
  subtitulo.value = `PLANILLA DEL CHOFER · ${fechaDeLaOrden(sheet.date)}`;
  subtitulo.font = { bold: true, size: 12 };
  subtitulo.alignment = { vertical: "middle" };

  let fila = 5;
  page.mergeCells(`A${fila}:G${fila}`);
  const banda = page.getCell(fila, 1);
  banda.value = `${sheet.heading} · ${sheet.vehicle}`;
  banda.font = { bold: true, size: 11, color: { argb: VERDE } };
  for (let columna = 1; columna <= ROUTE_SHEET_COLUMNS.length; columna += 1) {
    page.getCell(fila, columna).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE_SUAVE } };
  }
  fila += 1;

  const encabezado = page.getRow(fila);
  ROUTE_SHEET_COLUMNS.forEach((columna, indice) => {
    const celda = encabezado.getCell(indice + 1);
    celda.value = columna;
    celda.font = { bold: true, size: 9 };
  });
  fila += 1;

  if (sheet.passengers.length === 0) {
    page.getCell(fila, 1).value = "Esta salida todavía no tiene pasajeros confirmados.";
    fila += 1;
  }

  for (const pasajero of sheet.passengers) {
    const filaDatos = page.getRow(fila);
    const celdas = routeSheetRow(pasajero);
    celdas.forEach((valor, indice) => {
      // El contacto abre el WhatsApp desde el propio Excel, igual que en la orden de servicio (#135):
      // con la celda como texto plano el chofer tiene que copiar el número a mano.
      if (ROUTE_SHEET_COLUMNS[indice] === "Contacto") {
        const whatsapp = whatsappLink(valor);
        filaDatos.getCell(indice + 1).value = whatsapp ? { text: valor, hyperlink: whatsapp, tooltip: "Abrir WhatsApp" } : valor;
        if (whatsapp) filaDatos.getCell(indice + 1).font = { underline: true };
        return;
      }
      filaDatos.getCell(indice + 1).value = valor;
    });
    fila += 1;
  }

  if (sheet.passengers.length > 0) {
    const total = page.getRow(fila);
    total.getCell(1).value = `Total ${sheet.routeLabel}`;
    total.getCell(1).font = { bold: true };
    total.getCell(2).value = sheet.totalSeats;
    total.getCell(2).font = { bold: true };
    total.getCell(6).value = plata(sheet.totalCents, sheet.currency);
    total.getCell(6).font = { bold: true };
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Pie de la hoja: las mismas aclaraciones que la orden de servicio y la planilla de excursiones. */
export const ROUTE_SHEET_FOOTNOTE =
  "«Derivado por» es la agencia o voucher que originó la venta; si se vendió directo, va vacío. Cobrar / Pagado es el estado del pago. " +
  "Las filas siguen el orden de las paradas de la ruta y al final quedan los pasajeros sin parada cargada. El contacto abre el WhatsApp con un toque.";
