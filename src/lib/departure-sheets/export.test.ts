import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildDepartureSheetRows, buildDepartureSheetWorkbook, departureSheetFileBase } from "./export";
import type { DepartureSheetPassengerRow } from "./types";

const pasajeros: DepartureSheetPassengerRow[] = [
  {
    position: 2,
    firstName: "Ana",
    lastName: "Pérez",
    documentType: "DNI",
    documentNumber: "30111222",
    sex: "F",
    birthDate: new Date("1985-04-12T15:00:00.000Z"),
    nationality: "Argentina",
    occupation: "Docente",
    residenceCountry: "Argentina"
  },
  {
    position: 1,
    firstName: "Bruno",
    lastName: "Gómez",
    documentType: "PAS",
    documentNumber: "AA123456",
    sex: "M",
    birthDate: new Date("1979-01-05T15:00:00.000Z"),
    nationality: "Chilena",
    occupation: "Comerciante",
    residenceCountry: "Chile"
  }
];

describe("planilla exportada", () => {
  it("usa los encabezados del DUT tal como vienen en la planilla del cliente", () => {
    const rows = buildDepartureSheetRows("DUT", pasajeros);

    expect(rows.header).toEqual([
      "apellido",
      "nombre",
      "tipo_documento",
      "numero_documento",
      "sexo",
      "fecha nac",
      "nacionalidad"
    ]);
    expect(rows.rows[0]).toEqual(["Gómez", "Bruno", "PAS", "AA123456", "M", pasajeros[1].birthDate, "Chilena"]);
  });

  it("usa los encabezados del registro de salida y respeta el orden del Nº", () => {
    const rows = buildDepartureSheetRows("PROVINCIA", pasajeros);

    expect(rows.header).toEqual([
      "Nº",
      "Apellido y Nombre",
      "Fecha de Nac",
      "Nacionalidad",
      "Ocupación",
      "Sexo",
      "Tipo y Nº Documento",
      "País de Residen."
    ]);
    expect(rows.rows[0]).toEqual([
      1,
      "Gómez Bruno",
      pasajeros[1].birthDate,
      "Chilena",
      "Comerciante",
      "M",
      "PAS AA123456",
      "Chile"
    ]);
  });

  it("genera un .xlsx con el encabezado congelado y una fila por pasajero", async () => {
    const buffer = await buildDepartureSheetWorkbook(
      { kind: "PROVINCIA", reservationCode: "ARC-2611-ABC123" },
      pasajeros
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Registro de salida");

    expect(sheet).toBeDefined();
    expect(sheet?.rowCount).toBe(3);
    expect(sheet?.getRow(1).values).toEqual([
      undefined,
      "Nº",
      "Apellido y Nombre",
      "Fecha de Nac",
      "Nacionalidad",
      "Ocupación",
      "Sexo",
      "Tipo y Nº Documento",
      "País de Residen."
    ]);
    expect(sheet?.getCell("B2").value).toBe("Gómez Bruno");
  });

  it("nombra el archivo con el tipo de planilla y el código de la reserva", () => {
    expect(departureSheetFileBase({ kind: "DUT", reservationCode: "ARC-2611-ABC123" })).toBe(
      "planilla-dut-arc-2611-abc123"
    );
    expect(departureSheetFileBase({ kind: "PROVINCIA", reservationCode: "ARC-2611-ABC123" })).toBe(
      "planilla-registro-de-salida-arc-2611-abc123"
    );
  });
});
