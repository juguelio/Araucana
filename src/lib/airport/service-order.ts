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
 * - **«Derivado por» sale del dato que carga el panel** (`Reservation.referredBy`, issue #109). Si
 *   la reserva se vendió directo la celda va vacía: no se deduce del pago ni se inventa.
 * - **Pago** se arma con el importe y el estado del pago de la reserva (`Cobrar` / `Pagado`), no
 *   con una etiqueta suelta: el chofer cobra contra ese monto.
 */
import ExcelJS from "exceljs";
import { airportPickupStart } from "./pickup-start";
import { ORDER_LOGO_PNG_BASE64 } from "./service-order-logo";

export type ServiceOrderDirection = "ARRIVAL" | "DEPARTURE";

/** Lo mínimo que necesita la hoja; no depende de Prisma para poder testearse sin base. */
export type ServiceOrderReservationInput = {
  code: string;
  /** Quién derivó la venta (agencia, voucher). `null` cuando se vendió directo. */
  referredBy?: string | null;
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
  /** Quién derivó la venta; `null` cuando la reserva se vendió directo. */
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
      referredBy: reserva.referredBy?.trim() || null,
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

export function serviceOrderFileName(date: string, flightReference?: string | null) {
  const sufijo = flightReference
    ? `-${flightReference
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()}`
    : "";

  return `orden-de-servicio-${date}${sufijo}.xlsx`;
}

export type ServiceOrderMeta = {
  date: string;
  generatedAt: Date;
};

/**
 * Paleta del sitio (`globals.css`): el encabezado de la hoja usa el verde profundo de la marca, con
 * el logo blanco arriba (el logo es blanco con fondo transparente, así que sobre papel blanco sería
 * invisible: siempre va sobre la banda oscura).
 */
const VERDE = "FF1F5B4F";
const VERDE_HONDO = "FF0E3D34";
const VERDE_SUAVE = "FFD5E1DC";
const ZEBRA = "FFF7F4EC";
const BORDE = "FFC9C3B2";
const TINTA = "FF233024";
const GRIS = "FF6B6455";
const COBRAR = "FFA32A1F";
const PAGADO = "FF1F5B4F";

const FILA_ENCABEZADO = 5;

/**
 * Anchos de columna en «caracteres» de Excel, en A4 horizontal: la hoja se imprime sin escalar.
 * Ojo: el alto de cada renglón se calcula contra estos anchos (`lineasDeTexto`), así que si cambia
 * uno hay que cambiar el otro — si no, el texto se corta.
 */
const ANCHOS = [26, 5, 14, 30, 13, 15, 15] as const;

/**
 * Cuántos renglones ocupa un texto en una columna de `ancho` caracteres, con fuente de `pt`.
 * Sirve para fijar el alto de la fila: con un alto fijo, una dirección larga se corta y el chofer
 * termina leyendo media dirección (pasó con las direcciones de Google, que traen 70 caracteres).
 */
export function lineasDeTexto(texto: string, ancho: number, pt = 10) {
  // El ancho de columna de Excel está en «caracteres» del font por defecto (11 pt). Bajar el cuerpo
  // no aumenta los caracteres de forma lineal: se compensa con la raíz. Y se deja aire (0.95)
  // porque una dirección se corta antes de lo que dice la cuenta teórica.
  const capacidad = Math.max(4, Math.floor(ancho * 0.95 * Math.sqrt(11 / pt)));
  let lineas = 1;
  let usado = 0;

  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const suma = usado === 0 ? palabra.length : usado + 1 + palabra.length;
    if (suma > capacidad && usado > 0) {
      lineas += 1;
      usado = palabra.length;
    } else {
      usado = suma;
    }
  }

  return lineas;
}

const BORDE_FINO: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: BORDE } },
  left: { style: "thin", color: { argb: BORDE } },
  bottom: { style: "thin", color: { argb: BORDE } },
  right: { style: "thin", color: { argb: BORDE } }
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

type Rango = { fila: number; desde: number; hasta: number };

/** Pinta un tramo de la fila: en Excel el relleno de una celda combinada no se propaga al resto. */
function pintarFila(sheet: ExcelJS.Worksheet, rango: Rango, color: string) {
  const fila = sheet.getRow(rango.fila);
  for (let columna = rango.desde; columna <= rango.hasta; columna += 1) {
    fila.getCell(columna).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  }
}

/**
 * Genera el .xlsx de la orden de servicio: encabezado con el logo y la fecha, una banda por vuelo,
 * una fila por reserva y los totales. Un día sin pasajeros se avisa en la hoja en vez de devolver
 * un archivo vacío o un error.
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
    views: [{ state: "frozen", ySplit: FILA_ENCABEZADO }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: `${FILA_ENCABEZADO}:${FILA_ENCABEZADO}`,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.55, header: 0.25, footer: 0.25 }
    }
  });

  sheet.columns = ANCHOS.map((width) => ({ width }));

  // --- Encabezado: banda verde con logo, título y fecha -------------------------------------
  for (let fila = 1; fila <= 3; fila += 1) {
    pintarFila(sheet, { fila, desde: 1, hasta: 7 }, VERDE_HONDO);
  }
  sheet.getRow(1).height = 26;
  sheet.getRow(2).height = 20;
  sheet.getRow(3).height = 15;

  // El cast es sólo de tipos: con @types/node nuevo, `Buffer.from` y el `buffer` que declara
  // ExcelJS son dos genéricos de Buffer distintos. En runtime es el mismo Buffer.
  const logoPng = Buffer.from(ORDER_LOGO_PNG_BASE64, "base64");
  const logoId = workbook.addImage({
    buffer: logoPng as unknown as NonNullable<Parameters<ExcelJS.Workbook["addImage"]>[0]["buffer"]>,
    extension: "png"
  });
  sheet.addImage(logoId, {
    tl: { col: 0.12, row: 0.1 },
    ext: { width: 122, height: 62 }
  });

  sheet.mergeCells("C1:E1");
  const titulo = sheet.getCell("C1");
  titulo.value = "ORDEN DE SERVICIO";
  titulo.font = { bold: true, size: 17, color: { argb: "FFFFFFFF" } };
  titulo.alignment = { horizontal: "center", vertical: "middle" };

  sheet.mergeCells("C2:E2");
  const subtitulo = sheet.getCell("C2");
  subtitulo.value = "Traslados AEROPUERTO CHAPELCO";
  subtitulo.font = { size: 10.5, color: { argb: "FFD5E1DC" } };
  subtitulo.alignment = { horizontal: "center", vertical: "middle" };

  sheet.mergeCells("C3:E3");
  const emitida = sheet.getCell("C3");
  emitida.value = `Emitida el ${emitidaEl(meta.generatedAt)}`;
  emitida.font = { size: 8, color: { argb: "FF9BB8AF" } };
  emitida.alignment = { horizontal: "center", vertical: "middle" };

  const etiquetaFecha = sheet.getCell("F1");
  etiquetaFecha.value = "FECHA";
  etiquetaFecha.font = { bold: true, size: 8, color: { argb: "FF9BB8AF" } };
  etiquetaFecha.alignment = { horizontal: "right", vertical: "bottom" };

  sheet.mergeCells("F2:G2");
  const fecha = sheet.getCell("F2");
  fecha.value = fechaDeLaOrden(meta.date);
  fecha.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  fecha.alignment = { horizontal: "right", vertical: "middle" };

  const pasajerosDelDia = blocks.reduce(
    (total, block) => total + block.passengers.reduce((suma, pasajero) => suma + pasajero.seats, 0),
    0
  );
  sheet.mergeCells("F3:G3");
  const resumen = sheet.getCell("F3");
  resumen.value = `${blocks.length} ${blocks.length === 1 ? "vuelo" : "vuelos"} · ${pasajerosDelDia} pasajeros`;
  resumen.font = { size: 8, color: { argb: "FF9BB8AF" } };
  resumen.alignment = { horizontal: "right", vertical: "top" };

  sheet.getRow(4).height = 7;

  // --- Encabezado de la tabla ----------------------------------------------------------------
  const encabezado = sheet.getRow(FILA_ENCABEZADO);
  SERVICE_ORDER_COLUMNS.forEach((columna, indice) => {
    const celda = encabezado.getCell(indice + 1);
    celda.value = columna;
    celda.font = { bold: true, size: 10, color: { argb: TINTA } };
    celda.alignment = { vertical: "middle", horizontal: indice === 1 ? "center" : "left" };
    celda.border = BORDE_FINO;
  });
  pintarFila(sheet, { fila: FILA_ENCABEZADO, desde: 1, hasta: 7 }, VERDE_SUAVE);
  encabezado.height = 22;

  let fila = FILA_ENCABEZADO + 1;

  if (blocks.length === 0) {
    const vacio = sheet.getRow(fila++);
    sheet.mergeCells(`A${fila - 1}:G${fila - 1}`);
    vacio.getCell(1).value = `Sin pasajeros cargados para ${fechaDeLaOrden(meta.date)}.`;
    vacio.getCell(1).font = { italic: true, size: 10, color: { argb: GRIS } };
    vacio.height = 22;
  }

  for (const block of blocks) {
    // Banda del vuelo: a la izquierda el rótulo de la operación, a la derecha cuántos van y cuánto.
    const banda = sheet.getRow(fila);
    sheet.mergeCells(`A${fila}:E${fila}`);
    sheet.mergeCells(`F${fila}:G${fila}`);
    const celdaBanda = banda.getCell(1);
    celdaBanda.value = blockTimeLabel(block);
    celdaBanda.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    celdaBanda.alignment = { vertical: "middle" };
    const lugaresDelBloque = block.passengers.reduce((total, pasajero) => total + pasajero.seats, 0);
    const celdaBandaMonto = banda.getCell(6);
    celdaBandaMonto.value = `${lugaresDelBloque} ${lugaresDelBloque === 1 ? "pasajero" : "pasajeros"} · ${plata(
      block.totalCents,
      block.passengers[0]?.currency ?? "ARS"
    )}`;
    celdaBandaMonto.font = { bold: true, size: 10, color: { argb: "FFD5E1DC" } };
    celdaBandaMonto.alignment = { vertical: "middle", horizontal: "right" };
    pintarFila(sheet, { fila, desde: 1, hasta: 7 }, VERDE);
    banda.height = 20;
    fila += 1;

    block.passengers.forEach((pasajero, indice) => {
      const renglon = sheet.getRow(fila);
      const celdaPasajero = renglon.getCell(1);
      celdaPasajero.value = pasajero.name;
      celdaPasajero.font = { bold: true, size: 10, color: { argb: TINTA } };

      const celdaCant = renglon.getCell(2);
      celdaCant.value = pasajero.seats;
      celdaCant.numFmt = "0";
      celdaCant.font = { bold: true, size: 10, color: { argb: TINTA } };
      celdaCant.alignment = { horizontal: "center" };

      const celdaDni = renglon.getCell(3);
      celdaDni.value = pasajero.document;
      celdaDni.numFmt = "@";
      celdaDni.font = { size: 9.5, color: { argb: TINTA } };
      celdaDni.alignment = { horizontal: "center" };

      // Alojamiento en dos tonos: el lugar en negrita y la dirección abajo, más chica.
      const celdaAlojamiento = renglon.getCell(4);
      celdaAlojamiento.value = pasajero.lodgingDetail
        ? {
            richText: [
              { font: { bold: true, size: 9.5, color: { argb: TINTA } }, text: pasajero.lodging },
              { font: { size: 8.5, color: { argb: GRIS } }, text: `\n${pasajero.lodgingDetail}` }
            ]
          }
        : { richText: [{ font: { bold: true, size: 9.5, color: { argb: TINTA } }, text: pasajero.lodging }] };

      const celdaDerivado = renglon.getCell(5);
      celdaDerivado.value = pasajero.referredBy;
      celdaDerivado.font = { size: 9.5, color: { argb: GRIS } };

      const celdaPago = renglon.getCell(6);
      celdaPago.value = pasajero.payment;
      celdaPago.font = {
        bold: true,
        size: 9.5,
        color: { argb: pasajero.payment.startsWith("Pagado") ? PAGADO : COBRAR }
      };
      celdaPago.alignment = { horizontal: "right" };

      const celdaContacto = renglon.getCell(7);
      celdaContacto.value = pasajero.contact;
      celdaContacto.numFmt = "@";
      celdaContacto.font = { size: 9.5, color: { argb: TINTA } };

      for (let columna = 1; columna <= 7; columna += 1) {
        const celda = renglon.getCell(columna);
        celda.border = BORDE_FINO;
        celda.alignment = { ...celda.alignment, vertical: "middle", wrapText: columna === 1 || columna === 4 };
      }
      if (indice % 2 === 1) pintarFila(sheet, { fila, desde: 1, hasta: 7 }, ZEBRA);

      // El alto sale del texto: con un alto fijo la dirección se corta y no se lee a dónde ir.
      const lineasAlojamiento = lineasDeTexto(
        [pasajero.lodging, pasajero.lodgingDetail].filter(Boolean).join(" "),
        ANCHOS[3],
        9.5
      );
      const lineasPasajero = lineasDeTexto(pasajero.name, ANCHOS[0], 10);
      renglon.height = Math.max(18, Math.max(lineasAlojamiento, lineasPasajero) * 12 + 6);
      fila += 1;
    });

    const subtotal = sheet.getRow(fila);
    sheet.mergeCells(`A${fila}:E${fila}`);
    const etiquetaSubtotal = subtotal.getCell(1);
    etiquetaSubtotal.value = `Total ${block.heading} ${block.flightNumber}`;
    etiquetaSubtotal.font = { bold: true, size: 9.5, color: { argb: GRIS } };
    etiquetaSubtotal.alignment = { horizontal: "right", vertical: "middle" };
    const montoSubtotal = subtotal.getCell(6);
    // Texto, no número: el importe se arma con el mismo formateador que la columna Pago, así se
    // lee igual en Excel, en Numbers y en la vista previa del sistema (cada uno formatea distinto
    // un número con moneda, y la hoja terminaba mezclando «$ 10.400» con «ARS 10,400»).
    montoSubtotal.value = plata(block.totalCents, block.passengers[0]?.currency ?? "ARS");
    montoSubtotal.font = { bold: true, size: 10, color: { argb: TINTA } };
    montoSubtotal.alignment = { horizontal: "right", vertical: "middle" };
    for (let columna = 1; columna <= 7; columna += 1) {
      subtotal.getCell(columna).border = {
        bottom: { style: "thin", color: { argb: BORDE } }
      };
    }
    subtotal.height = 17;

    const separacion = sheet.getRow(fila + 1);
    separacion.height = 7;
    fila += 2;
  }

  if (blocks.length > 0) {
    const total = sheet.getRow(fila);
    sheet.mergeCells(`A${fila}:E${fila}`);
    const etiquetaTotal = total.getCell(1);
    etiquetaTotal.value = "TOTAL DEL DÍA";
    etiquetaTotal.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    etiquetaTotal.alignment = { horizontal: "right", vertical: "middle" };
    const montoTotal = total.getCell(6);
    montoTotal.value = plata(
      blocks.reduce((suma, block) => suma + block.totalCents, 0),
      blocks[0].passengers[0]?.currency ?? "ARS"
    );
    montoTotal.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    montoTotal.alignment = { horizontal: "right", vertical: "middle" };
    pintarFila(sheet, { fila, desde: 1, hasta: 7 }, VERDE_HONDO);
    total.height = 24;

    const nota = sheet.getRow(fila + 2);
    sheet.mergeCells(`A${fila + 2}:G${fila + 2}`);
    nota.getCell(1).value =
      "Derivado por es el origen que se cargó en la reserva (agencia o voucher); si la venta fue directa, va vacío. " +
      "El detalle del pago (voucher, quién cobra) se completa a mano. Cobrar / Pagado es el estado del pago de la reserva.";
    nota.getCell(1).font = { size: 8, italic: true, color: { argb: GRIS } };
    nota.getCell(1).alignment = { wrapText: true };
    const anchoTotal = ANCHOS.reduce((total, ancho) => total + ancho, 0);
    nota.height = Math.max(14, lineasDeTexto(String(nota.getCell(1).value), anchoTotal, 8) * 11 + 4);
  }

  sheet.headerFooter = {
    oddFooter: "&L&\"Calibri,Italic\"&8La Araucana Viajes S.R.L. · orden de servicio&R&8Página &P de &N"
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
