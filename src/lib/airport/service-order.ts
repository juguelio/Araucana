/**
 * Orden de servicio del aeropuerto: la hoja que se le entrega al chofer.
 *
 * El cliente la usa hoy en papel y pidió que el sistema devuelva lo mismo (foto del 2026-11-12,
 * issue #74): encabezado con la fecha, un bloque por vuelo —`OUT 1671` para las partidas y
 * `Llega 1670` para los arribos— y una fila por reserva con
 * `Pasajero · Cant · DNI · Alojamiento · Derivado por · Pago · Contacto`, con el total al pie de
 * cada bloque y el total del día al final.
 *
 * Reglas que importan más acá que el formato:
 *
 * - **El dato del chofer es la dirección, no el nombre del hotel.** Se usa `pickupName` (el lugar
 *   que eligió el pasajero) y `pickupAddress` (la referencia que escribió para el chofer): en las
 *   partidas es de dónde se lo busca, en los arribos es a dónde se lo lleva.
 * - **«Derivado por» se imprime vacío a propósito.** Quién derivó la reserva (una agencia, «El
 *   Claro», un voucher) no existe en el modelo todavía; inventarlo o deducirlo del pago sería
 *   afirmar algo que el sistema no sabe. La columna queda para completar a mano, igual que hoy.
 * - **Pago** se arma con el importe y el estado del pago de la reserva (`Cobrar` / `Pagado`), no
 *   con una etiqueta suelta: el chofer cobra contra ese monto.
 */
import ExcelJS from "exceljs";
import { airportPickupStart } from "./pickup-start";

export type ServiceOrderDirection = "ARRIVAL" | "DEPARTURE";

/** Lo mínimo que necesita la hoja; no depende de Prisma para poder testearse sin base. */
export type ServiceOrderReservationInput = {
  code: string;
  totalCents: number;
  currency: string;
  passengerCount: number;
  paymentStatus: string | null;
  direction: string;
  flightNumber: string;
  pickupName: string | null;
  pickupAddress: string | null;
  pickupNotes: string | null;
  passenger: {
    firstName: string;
    lastName: string;
    phone: string;
    documentType: string;
    documentId: string;
  };
  flight: {
    id: string;
    number: string;
    airline: string | null;
    direction: string;
    scheduledAt: Date;
    estimatedAt: Date | null;
    pickupStartOverrideAt: Date | null;
  } | null;
};

export type ServiceOrderPassenger = {
  code: string;
  name: string;
  seats: number;
  document: string;
  lodging: string;
  lodgingDetail: string | null;
  /** Hoy siempre `null`: el sistema no guarda quién derivó la reserva. */
  referredBy: string | null;
  payment: string;
  amountCents: number;
  currency: string;
  contact: string;
};

export type ServiceOrderBlock = {
  key: string;
  direction: ServiceOrderDirection;
  flightNumber: string;
  airline: string | null;
  /** `OUT` en las partidas, `Llega` en los arribos: el rótulo de la hoja en papel. */
  heading: string;
  /** Cuándo arranca la recorrida (partidas) o cuándo llega el vuelo (arribos). */
  operationAt: Date;
  /** Hora programada del vuelo. */
  scheduledAt: Date;
  /** Hora que manda para el chofer: el despegue programado o la llegada estimada si la hay. */
  flightAt: Date;
  estimatedAt: Date | null;
  passengers: ServiceOrderPassenger[];
  totalCents: number;
};

const SALTA_TIME = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Salta"
});

export const horaEnSalta = (value: Date) => SALTA_TIME.format(value);

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * «Jueves 10-feb»: la fecha tal como la escribe el cliente en la planilla.
 * La fecha del servicio es un día de calendario, así que se lee en UTC: pasarla por la zona
 * argentina (UTC−3) la corre al día anterior.
 */
export function fechaDeLaOrden(date: string) {
  const valor = new Date(`${date}T12:00:00.000Z`);
  return `${DIAS[valor.getUTCDay()]} ${String(valor.getUTCDate()).padStart(2, "0")}-${MESES[valor.getUTCMonth()]}`;
}

export function plata(cents: number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(cents / 100);
}

/** Lo que el chofer lee en la columna Pago: el monto y si falta cobrarlo. */
export function paymentLabel(status: string | null, cents: number, currency = "ARS") {
  const monto = plata(cents, currency);

  if (status === "APPROVED") return `Pagado ${monto}`;
  if (status === "REJECTED") return `Rechazado ${monto}`;
  return `Cobrar ${monto}`;
}

/** El DNI se imprime solo; pasaporte o cédula se aclaran para que no se confundan con un DNI. */
export function documentoDelPasajero(documentType: string, documentId: string) {
  const tipo = documentType.trim().toUpperCase();
  const numero = documentId.trim();
  return tipo === "DNI" || !tipo ? numero : `${tipo} ${numero}`;
}

/**
 * El buscador devuelve la dirección con toda la cola administrativa
 * («…, Municipio de San Martín de los Andes, Departamento Lácar, Neuquén, 8370, Argentina»).
 * En la hoja del chofer eso es ruido: se corta en el municipio o el departamento, y si no hay,
 * se saca el país y el código postal que lo precede. El número de la altura no se toca: «1242»
 * parece un código postal y es la altura de la calle.
 */
const PROVINCIAS = new Set([
  "neuquén",
  "neuquen",
  "río negro",
  "rio negro",
  "chubut",
  "argentina",
  "lácar",
  "lacar"
]);

export function recortarDireccion(valor: string) {
  const partes = valor
    .split(",")
    .map((parte) => parte.trim())
    .filter(Boolean);

  let corte = partes.findIndex((parte) =>
    /^(municipio|departamento|provincia|comuna)\b/i.test(parte) || PROVINCIAS.has(parte.toLowerCase())
  );

  if (corte === -1) {
    const argentina = partes.findIndex((parte) => /^argentina$/i.test(parte));
    if (argentina !== -1) {
      corte = argentina;
      if (corte > 0 && /^\d{4}$/.test(partes[corte - 1])) corte -= 1;
    }
  }

  const utiles = corte === -1 ? partes : partes.slice(0, corte);

  return (utiles.length ? utiles.join(", ") : valor).trim();
}

/**
 * Alojamiento: el lugar («Patagonia Plaza») y abajo la dirección o el detalle que sirve para
 * llegar. Si sólo hay uno de los dos, ese.
 */
export function alojamientoDelPasajero(pickupName: string | null, pickupAddress: string | null) {
  const lugar = pickupName?.trim() ? recortarDireccion(pickupName.trim()) : null;
  const direccion = pickupAddress?.trim() ? recortarDireccion(pickupAddress.trim()) : null;

  if (lugar && direccion && lugar !== direccion) {
    return { lodging: lugar, lodgingDetail: direccion };
  }

  return { lodging: lugar ?? direccion ?? "—", lodgingDetail: null };
}

const direccionDelVuelo = (value: string): ServiceOrderDirection =>
  value === "ARRIVAL" ? "ARRIVAL" : "DEPARTURE";

/**
 * Agrupa las reservas del día en un bloque por vuelo, en el orden en que los atiende la camioneta:
 * primero la recorrida de las partidas y después los arribos.
 */
export function buildServiceOrderBlocks(reservations: ServiceOrderReservationInput[]): ServiceOrderBlock[] {
  const bloques = new Map<string, ServiceOrderBlock>();

  for (const reserva of reservations) {
    const direction = direccionDelVuelo(reserva.flight?.direction ?? reserva.direction);
    const key = reserva.flight?.id ?? `sin-vuelo:${direction}:${reserva.flightNumber}`;
    const scheduledAt = reserva.flight?.scheduledAt ?? null;
    const estimatedAt = reserva.flight?.estimatedAt ?? null;
    const operationAt =
      direction === "DEPARTURE"
        ? (airportPickupStart({
            direction,
            scheduledAt: scheduledAt ?? new Date(0),
            pickupStartOverrideAt: reserva.flight?.pickupStartOverrideAt ?? null
          }) ?? scheduledAt ?? new Date(0))
        : (estimatedAt ?? scheduledAt ?? new Date(0));

    const { lodging, lodgingDetail } = alojamientoDelPasajero(reserva.pickupName, reserva.pickupAddress);

    const pasajero: ServiceOrderPassenger = {
      code: reserva.code,
      name: `${reserva.passenger.firstName} ${reserva.passenger.lastName}`.trim(),
      seats: reserva.passengerCount,
      document: documentoDelPasajero(reserva.passenger.documentType, reserva.passenger.documentId),
      lodging,
      lodgingDetail,
      referredBy: null,
      payment: paymentLabel(reserva.paymentStatus, reserva.totalCents, reserva.currency),
      amountCents: reserva.totalCents,
      currency: reserva.currency,
      contact: reserva.passenger.phone
    };

    const existente = bloques.get(key);
    if (existente) {
      existente.passengers.push(pasajero);
      existente.totalCents += pasajero.amountCents;
      continue;
    }

    bloques.set(key, {
      key,
      direction,
      flightNumber: reserva.flight?.number ?? reserva.flightNumber,
      airline: reserva.flight?.airline ?? null,
      heading: direction === "DEPARTURE" ? "OUT" : "Llega",
      operationAt,
      scheduledAt: scheduledAt ?? operationAt,
      flightAt: direction === "DEPARTURE" ? (scheduledAt ?? operationAt) : (estimatedAt ?? scheduledAt ?? operationAt),
      estimatedAt,
      passengers: [pasajero],
      totalCents: pasajero.amountCents
    });
  }

  return [...bloques.values()]
    .map((bloque) => ({
      ...bloque,
      passengers: [...bloque.passengers].sort((a, b) => a.name.localeCompare(b.name, "es"))
    }))
    .sort((a, b) => a.operationAt.getTime() - b.operationAt.getTime());
}

/** Renglón de horario del bloque: lo que va en la banda gris sobre los pasajeros. */
export function blockTimeLabel(block: ServiceOrderBlock) {
  if (block.direction === "DEPARTURE") {
    const despegue = horaEnSalta(block.flightAt);
    return `${block.heading} ${block.flightNumber} · recorrida ${horaEnSalta(block.operationAt)} · despegue ${despegue}`;
  }

  const llega = horaEnSalta(block.flightAt);
  const programado = horaEnSalta(block.scheduledAt);
  const demorado = llega !== programado ? ` (programado ${programado})` : "";

  return `${block.heading} ${block.flightNumber} · llega ${llega}${demorado}`;
}

export const SERVICE_ORDER_COLUMNS = [
  "Pasajero",
  "Cant",
  "DNI",
  "Alojamiento",
  "Derivado por",
  "Pago",
  "Contacto"
] as const;

export function serviceOrderFileName(date: string) {
  return `orden-de-servicio-${date}.xlsx`;
}

export type ServiceOrderMeta = {
  date: string;
  generatedAt: Date;
};

const HEADER_FILL = "FFE7DFCB";
const BAND_FILL = "FFD8D2C3";
const TEXT_COLOR = "FF233024";
const MUTED = "FF6B6455";
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FF9A9483" } },
  left: { style: "thin", color: { argb: "FF9A9483" } },
  bottom: { style: "thin", color: { argb: "FF9A9483" } },
  right: { style: "thin", color: { argb: "FF9A9483" } }
};

const emitidaEl = (value: Date) =>
  new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Argentina/Salta"
  }).format(value);

/**
 * Genera el .xlsx con la forma de la orden de servicio en papel: encabezado con la fecha, una
 * banda por vuelo, los pasajeros y los totales. Un día sin pasajeros se avisa en la hoja en vez
 * de devolver un archivo vacío o un error.
 */
export async function buildServiceOrderWorkbook(
  meta: ServiceOrderMeta,
  blocks: ServiceOrderBlock[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "La Araucana Viajes";
  workbook.created = meta.generatedAt;
  workbook.modified = meta.generatedAt;

  const sheet = workbook.addWorksheet("Orden de servicio", {
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
    }
  });

  // Anchos pensados para A4 horizontal: la hoja se imprime sin escalar y sin cortar columnas.
  sheet.columns = [
    { width: 26 },
    { width: 5 },
    { width: 14 },
    { width: 30 },
    { width: 13 },
    { width: 15 },
    { width: 15 }
  ];

  let fila = 1;

  const marca = sheet.getRow(fila++);
  marca.getCell(1).value = "La Araucana viajes SRL";
  marca.getCell(1).font = { italic: true, size: 9, color: { argb: MUTED } };
  sheet.mergeCells(`C${fila - 1}:F${fila - 1}`);
  const titulo = sheet.getCell(`C${fila - 1}`);
  titulo.value = "ORDEN DE SERVICIO";
  titulo.font = { bold: true, size: 15, color: { argb: TEXT_COLOR } };
  titulo.alignment = { horizontal: "center", vertical: "middle" };
  const etiquetaFecha = sheet.getCell(`G${fila - 1}`);
  etiquetaFecha.value = "FECHA";
  etiquetaFecha.font = { bold: true, size: 9 };
  etiquetaFecha.alignment = { horizontal: "center" };
  etiquetaFecha.border = BORDER;

  const subtitulo = sheet.getRow(fila++);
  subtitulo.getCell(1).value = "Traslados AEROPUERTO CHAPELCO";
  subtitulo.getCell(1).font = { bold: true, size: 12, color: { argb: TEXT_COLOR } };
  const fecha = sheet.getCell(`G${fila - 1}`);
  fecha.value = fechaDeLaOrden(meta.date);
  fecha.font = { bold: true, size: 11 };
  fecha.alignment = { horizontal: "center" };
  fecha.border = BORDER;

  const pie = sheet.getRow(fila++);
  pie.getCell(1).value = `Emitida el ${emitidaEl(meta.generatedAt)}`;
  pie.getCell(1).font = { size: 9, color: { argb: MUTED } };

  fila += 1;

  const encabezado = sheet.getRow(fila++);
  SERVICE_ORDER_COLUMNS.forEach((columna, indice) => {
    const celda = encabezado.getCell(indice + 1);
    celda.value = columna;
    celda.font = { bold: true, color: { argb: TEXT_COLOR } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    celda.alignment = { vertical: "middle", horizontal: indice === 1 ? "center" : "left" };
    celda.border = BORDER;
  });
  encabezado.height = 20;
  sheet.views = [{ state: "frozen", ySplit: fila - 1 }];

  if (blocks.length === 0) {
    const vacio = sheet.getRow(fila++);
    sheet.mergeCells(`A${fila - 1}:G${fila - 1}`);
    vacio.getCell(1).value = `Sin pasajeros cargados para ${fechaDeLaOrden(meta.date)}.`;
    vacio.getCell(1).font = { italic: true, color: { argb: MUTED } };
  }

  for (const block of blocks) {
    const banda = sheet.getRow(fila++);
    sheet.mergeCells(`A${fila - 1}:G${fila - 1}`);
    const celdaBanda = banda.getCell(1);
    celdaBanda.value = blockTimeLabel(block);
    celdaBanda.font = { bold: true, size: 11, color: { argb: TEXT_COLOR } };
    celdaBanda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_FILL } };
    celdaBanda.alignment = { vertical: "middle" };
    celdaBanda.border = BORDER;
    banda.height = 18;

    for (const pasajero of block.passengers) {
      const renglon = sheet.getRow(fila++);
      const valores: (string | number | null)[] = [
        pasajero.name,
        pasajero.seats,
        pasajero.document,
        pasajero.lodgingDetail ? `${pasajero.lodging}\n${pasajero.lodgingDetail}` : pasajero.lodging,
        pasajero.referredBy,
        pasajero.payment,
        pasajero.contact
      ];

      valores.forEach((valor, indice) => {
        const celda = renglon.getCell(indice + 1);
        celda.value = valor;
        celda.border = BORDER;
        celda.alignment = {
          vertical: "top",
          horizontal: indice === 1 ? "center" : indice === 5 ? "right" : "left",
          wrapText: indice === 3
        };
        if (indice === 1) celda.numFmt = "0";
        if (indice === 2 || indice === 6) celda.numFmt = "@";
      });
    }

    const subtotal = sheet.getRow(fila++);
    sheet.mergeCells(`A${fila - 1}:E${fila - 1}`);
    const etiquetaSubtotal = subtotal.getCell(1);
    const lugares = block.passengers.reduce((total, pasajero) => total + pasajero.seats, 0);
    etiquetaSubtotal.value = `Total ${block.heading} ${block.flightNumber} · ${lugares} ${lugares === 1 ? "pasajero" : "pasajeros"}`;
    etiquetaSubtotal.font = { bold: true };
    etiquetaSubtotal.alignment = { horizontal: "right" };
    etiquetaSubtotal.border = BORDER;
    const montoSubtotal = subtotal.getCell(6);
    // Texto, no número: el importe se arma con el mismo formateador que la columna Pago, así se
    // lee igual en Excel, en Numbers y en la vista previa del sistema (cada uno formatea distinto
    // un número con moneda, y la hoja terminaba mezclando «$ 10.400» con «ARS 10,400»).
    montoSubtotal.value = plata(block.totalCents, block.passengers[0]?.currency ?? "ARS");
    montoSubtotal.font = { bold: true };
    montoSubtotal.alignment = { horizontal: "right" };
    montoSubtotal.border = BORDER;
    subtotal.getCell(7).border = BORDER;

    fila += 1;
  }

  if (blocks.length > 0) {
    const total = sheet.getRow(fila++);
    sheet.mergeCells(`A${fila - 1}:E${fila - 1}`);
    const etiquetaTotal = total.getCell(1);
    etiquetaTotal.value = "TOTAL DEL DÍA";
    etiquetaTotal.font = { bold: true, size: 12 };
    etiquetaTotal.alignment = { horizontal: "right" };
    const montoTotal = total.getCell(6);
    montoTotal.value = plata(
      blocks.reduce((suma, block) => suma + block.totalCents, 0),
      blocks[0].passengers[0]?.currency ?? "ARS"
    );
    montoTotal.font = { bold: true, size: 12 };
    montoTotal.alignment = { horizontal: "right" };
    montoTotal.border = { top: { style: "double" }, bottom: { style: "double" } };

    const nota = sheet.getRow(fila + 1);
    nota.getCell(1).value =
      "«Derivado por» y el detalle del pago (voucher, quién cobra) se completan a mano: el sistema todavía no los registra.";
    nota.getCell(1).font = { size: 9, italic: true, color: { argb: MUTED } };
    sheet.mergeCells(`A${fila + 1}:G${fila + 1}`);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
