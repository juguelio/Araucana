import { describe, expect, it } from "vitest";
import {
  buildExcursionSheetBlocks,
  excursionSheetRow,
  EXCURSION_SHEET_COLUMNS,
  excursionBlockLabel,
  type ExcursionSheetBookingInput
} from "./sheet";

const venta = (over: Partial<ExcursionSheetBookingInput> = {}): ExcursionSheetBookingInput => ({
  code: "ARC-2611-AAAA",
  excursionId: "exc-1",
  excursionName: "Ruta de los Siete Lagos",
  duration: "8 horas",
  departureAt: new Date("2026-11-20T12:00:00.000Z"),
  passengerCount: 2,
  totalCents: 9000000,
  currency: "ARS",
  status: "CONFIRMED",
  referredBy: null,
  passenger: {
    firstName: "Ana",
    lastName: "Pérez",
    documentType: "DNI",
    documentId: "30111222",
    phone: "+542944123456",
    email: "ana@example.com"
  },
  ...over
});

describe("planilla de excursiones (issue #110)", () => {
  it("arma un bloque por salida, con la excursión y la hora", () => {
    const blocks = buildExcursionSheetBlocks([venta()]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].excursionName).toBe("Ruta de los Siete Lagos");
    expect(blocks[0].passengers).toHaveLength(1);
    // 12:00Z son las 09:00 en San Martín de los Andes.
    expect(excursionBlockLabel(blocks[0])).toContain("09:00");
  });

  it("muestra «Derivado por» sólo cuando la venta viene de una agencia", () => {
    const [derivada] = buildExcursionSheetBlocks([venta({ referredBy: "Agencia Los Andes" })]);
    const [directa] = buildExcursionSheetBlocks([venta({ code: "ARC-2611-BBBB" })]);

    expect(excursionSheetRow(derivada.passengers[0])[3]).toBe("Agencia Los Andes");
    expect(excursionSheetRow(directa.passengers[0])[3]).toBe("");
  });

  it("la columna «Derivado por» queda en su lugar de la tabla", () => {
    const [bloque] = buildExcursionSheetBlocks([venta({ referredBy: "Voucher Sur" })]);
    const fila = excursionSheetRow(bloque.passengers[0]);

    expect(EXCURSION_SHEET_COLUMNS[3]).toBe("Derivado por");
    expect(fila).toHaveLength(EXCURSION_SHEET_COLUMNS.length);
    expect(fila[3]).toBe("Voucher Sur");
  });

  it("una venta directa y una derivada del mismo día conviven en la planilla", () => {
    const blocks = buildExcursionSheetBlocks([
      venta({ code: "ARC-2611-DIRECTA" }),
      venta({ code: "ARC-2611-DERIVADA", referredBy: "Agencia Los Andes" })
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].passengers.map((p) => p.referredBy)).toEqual([null, "Agencia Los Andes"]);
    expect(blocks[0].totalCents).toBe(18000000);
  });

  it("separa las salidas del día y las ordena por hora", () => {
    const blocks = buildExcursionSheetBlocks([
      venta({ code: "ARC-2611-TARDE", departureAt: new Date("2026-11-20T17:00:00.000Z"), excursionId: "exc-2", excursionName: "Cabalgata" }),
      venta({ code: "ARC-2611-TEMPRANO" })
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].excursionName).toBe("Ruta de los Siete Lagos");
    expect(blocks[1].excursionName).toBe("Cabalgata");
  });

  it("una excursión sin ventas no genera bloque", () => {
    expect(buildExcursionSheetBlocks([])).toEqual([]);
  });

  it("el documento del pasajero se muestra, no se inventa", () => {
    const [conDocumento] = buildExcursionSheetBlocks([venta()]);
    const [sinDocumento] = buildExcursionSheetBlocks([
      venta({ passenger: { ...venta().passenger, documentId: "" } })
    ]);

    expect(conDocumento.passengers[0].document).toBe("30111222");
    // Vacío se dibuja como «—» en la hoja: la planilla no rellena el dato.
    expect(sinDocumento.passengers[0].document).toBe("");
  });
});
