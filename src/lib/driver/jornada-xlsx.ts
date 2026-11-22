import ExcelJS from "exceljs";
import type { DiaDeFlota } from "./dia";
import { LIMITE_VELOCIDAD_KMH, PARADA_MINIMA_MINUTOS, minutosAHoras } from "./jornada";

/**
 * Planilla del resumen del día en Excel.
 *
 * La pantalla sirve para operar; el archivo es para lo que viene después: mandarlo al dueño, adjuntarlo
 * a la facturación del mes o guardarlo como respaldo de lo que hizo cada unidad. Misma fuente que la
 * pantalla (`DiaDeFlota`), así no hay dos versiones del mismo día.
 */

const VERDE = "FF17664F";
const VERDE_SUAVE = "FFE4EFE9";
const GRIS = "FFF3F1EC";

const COLUMNAS = [
  "Unidad", "Chofer", "Km", "Movimiento", "Detenida", "Vel. máx.", "Paradas", "Primera señal", "Última señal", "Reportes"
];
const ANCHOS = [14, 22, 9, 13, 13, 11, 9, 13, 13, 10];

export const COLUMNAS_DEL_RESUMEN = COLUMNAS;

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires"
  });
}

function fechaLarga(fecha: string) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia)).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

export function nombreArchivoJornada(fecha: string) {
  return `araucana-naves-${fecha}.xlsx`;
}

export async function buildJornadaWorkbook(dia: DiaDeFlota, meta: { generatedAt: Date }): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "La Araucana Viajes";
  workbook.created = meta.generatedAt;
  workbook.modified = meta.generatedAt;

  const hoja = workbook.addWorksheet("Resumen del día", {
    views: [{ state: "frozen", ySplit: 8 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  hoja.columns = ANCHOS.map((width) => ({ width }));

  hoja.mergeCells("A1:J3");
  const titulo = hoja.getCell("A1");
  titulo.value = "La Araucana viajes S.R.L.";
  titulo.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  titulo.alignment = { vertical: "middle" };
  for (let fila = 1; fila <= 3; fila += 1) {
    for (let columna = 1; columna <= COLUMNAS.length; columna += 1) {
      hoja.getCell(fila, columna).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
    }
  }

  hoja.mergeCells("A4:J4");
  const subtitulo = hoja.getCell("A4");
  subtitulo.value = `NAVES EN VIVO · RESUMEN DEL DÍA · ${fechaLarga(dia.fecha)}`;
  subtitulo.font = { bold: true, size: 12 };

  hoja.mergeCells("A5:J5");
  const totales = hoja.getCell("A5");
  totales.value =
    `${dia.totales.km.toLocaleString("es-AR")} km recorridos · ` +
    `${minutosAHoras(dia.totales.minutosEnMovimiento)} en movimiento · ` +
    `${minutosAHoras(dia.totales.minutosDetenido)} detenidas · ` +
    `${dia.totales.unidades} ${dia.totales.unidades === 1 ? "unidad" : "unidades"} con actividad`;
  totales.font = { bold: true, size: 11, color: { argb: VERDE } };
  for (let columna = 1; columna <= COLUMNAS.length; columna += 1) {
    hoja.getCell(5, columna).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE_SUAVE } };
  }

  if (dia.truncado) {
    hoja.mergeCells("A6:J6");
    const aviso = hoja.getCell("A6");
    aviso.value = "El día tiene más reportes de los que procesa este resumen: los totales son un piso.";
    aviso.font = { italic: true, size: 10, color: { argb: "FF8A2F1D" } };
  }

  const encabezado = hoja.getRow(8);
  COLUMNAS.forEach((columna, indice) => {
    const celda = encabezado.getCell(indice + 1);
    celda.value = columna;
    celda.font = { bold: true, size: 10 };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } };
  });

  let fila = 9;
  for (const jornada of dia.jornadas) {
    const actual = hoja.getRow(fila);
    actual.values = [
      jornada.internalNumber ?? jornada.vehicleName,
      jornada.driverName ?? "—",
      jornada.km,
      minutosAHoras(jornada.minutosEnMovimiento),
      minutosAHoras(jornada.minutosDetenido),
      jornada.velocidadMaximaKmh == null ? "—" : `${jornada.velocidadMaximaKmh} km/h`,
      jornada.paradas.length,
      hora(jornada.primeraSenal),
      hora(jornada.ultimaSenal),
      jornada.muestras
    ];
    actual.getCell(3).numFmt = "0.0";
    fila += 1;
  }

  fila += 1;
  hoja.mergeCells(`A${fila}:J${fila}`);
  const nota = hoja.getCell(fila, 1);
  nota.value =
    `Una parada se cuenta desde ${PARADA_MINIMA_MINUTOS} minutos. El exceso de velocidad se marca por encima de ` +
    `${LIMITE_VELOCIDAD_KMH} km/h. Las esperas de más de 60 minutos entre servicios no suman como parada.`;
  nota.font = { italic: true, size: 9, color: { argb: "FF6B6B6B" } };

  // Hoja 2: las paradas, que es lo que se discute cuando alguien reclama un horario.
  const paradas = workbook.addWorksheet("Paradas", {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  paradas.columns = [{ width: 14 }, { width: 22 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 34 }];
  const encabezadoParadas = paradas.getRow(1);
  ["Unidad", "Chofer", "Desde", "Hasta", "Minutos", "Dónde"].forEach((columna, indice) => {
    const celda = encabezadoParadas.getCell(indice + 1);
    celda.value = columna;
    celda.font = { bold: true, size: 10 };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } };
  });
  let filaParada = 2;
  for (const jornada of dia.jornadas) {
    for (const parada of jornada.paradas) {
      const actual = paradas.getRow(filaParada);
      const mapa = `https://maps.google.com/?q=${parada.latitude},${parada.longitude}`;
      actual.values = [
        jornada.internalNumber ?? jornada.vehicleName,
        jornada.driverName ?? "—",
        hora(parada.desde),
        hora(parada.hasta),
        parada.minutos,
        { text: `${parada.latitude.toFixed(5)}, ${parada.longitude.toFixed(5)}`, hyperlink: mapa }
      ];
      actual.getCell(6).font = { color: { argb: "FF1F5FA8" }, underline: true, size: 10 };
      filaParada += 1;
    }
  }
  if (filaParada === 2) {
    paradas.getCell(2, 1).value = "No hubo paradas de ese largo en el día.";
    paradas.getCell(2, 1).font = { italic: true };
  }

  // Hoja 3: lo que la pantalla marca «para revisar», para que viaje con el archivo.
  const revisar = workbook.addWorksheet("Para revisar", {
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  revisar.columns = [{ width: 12 }, { width: 90 }];
  const encabezadoRevisar = revisar.getRow(1);
  ["Nivel", "Detalle"].forEach((columna, indice) => {
    const celda = encabezadoRevisar.getCell(indice + 1);
    celda.value = columna;
    celda.font = { bold: true, size: 10 };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } };
  });
  if (dia.alertas.length === 0) {
    revisar.getCell(2, 1).value = "Sin novedades: todas las unidades reportaron y no hubo excesos.";
    revisar.getCell(2, 1).font = { italic: true };
  } else {
    dia.alertas.forEach((alerta, indice) => {
      const actual = revisar.getRow(indice + 2);
      actual.values = [alerta.severidad === "alta" ? "Crítica" : alerta.severidad === "media" ? "Atención" : "Aviso", alerta.texto];
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
