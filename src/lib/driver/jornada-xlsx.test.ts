import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { DiaDeFlota } from "./dia";
import { COLUMNAS_DEL_RESUMEN, buildJornadaWorkbook, nombreArchivoJornada } from "./jornada-xlsx";

function dia(extra: Partial<DiaDeFlota> = {}): DiaDeFlota {
  return {
    fecha: "2026-11-20",
    truncado: false,
    totales: { km: 32.5, minutosEnMovimiento: 64, minutosDetenido: 83, unidades: 1, muestras: 171 },
    alertas: [{ tipo: "exceso-de-velocidad", severidad: "media", driverId: "c1", vehicleId: "v1", texto: "Juan Muñoz · AR-08 llegó a 92 km/h (límite 80)" }],
    jornadas: [
      {
        clave: "c1::v1",
        driverId: "c1",
        driverName: "Juan Muñoz",
        vehicleId: "v1",
        vehicleName: "Araucana 08",
        internalNumber: "AR-08",
        km: 22.7,
        minutosEnMovimiento: 55,
        minutosDetenido: 10,
        velocidadMaximaKmh: 34,
        velocidadMaximaEn: "2026-11-20T11:20:00.000Z",
        velocidadMaximaPunto: [-40.157, -71.31],
        primeraSenal: "2026-11-20T11:09:00.000Z",
        ultimaSenal: "2026-11-21T01:25:00.000Z",
        ultimaPosicion: [-40.157, -71.31],
        muestras: 171,
        huecos: 1,
        paradas: [
          {
            desde: "2026-11-20T11:40:00.000Z",
            hasta: "2026-11-20T12:00:00.000Z",
            minutos: 20,
            latitude: -40.157,
            longitude: -71.31
          }
        ]
      }
    ],
    ...extra
  };
}

async function leer(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

describe("buildJornadaWorkbook", () => {
  it("arma las tres hojas con el mismo día que la pantalla", async () => {
    const workbook = await leer(await buildJornadaWorkbook(dia(), { generatedAt: new Date("2026-11-21T02:00:00Z") }));
    expect(workbook.worksheets.map((hoja) => hoja.name)).toEqual(["Resumen del día", "Paradas", "Para revisar"]);
  });

  it("la fila de la unidad repite los números del resumen", async () => {
    const workbook = await leer(await buildJornadaWorkbook(dia(), { generatedAt: new Date() }));
    const hoja = workbook.getWorksheet("Resumen del día")!;

    const encabezado = (hoja.getRow(8).values as unknown[]).slice(1);
    expect(encabezado).toEqual(COLUMNAS_DEL_RESUMEN);

    const fila = (hoja.getRow(9).values as unknown[]).slice(1);
    expect(fila[0]).toBe("AR-08");
    expect(fila[1]).toBe("Juan Muñoz");
    expect(fila[2]).toBe(22.7);
    expect(fila[3]).toBe("55 min");
    expect(fila[4]).toBe("10 min");
    expect(fila[5]).toBe("34 km/h");
    expect(fila[6]).toBe(1);
    expect(fila[9]).toBe(171);
  });

  it("lleva las paradas con su link al mapa y los minutos", async () => {
    const workbook = await leer(await buildJornadaWorkbook(dia(), { generatedAt: new Date() }));
    const hoja = workbook.getWorksheet("Paradas")!;
    const fila = (hoja.getRow(2).values as unknown[]).slice(1);
    expect(fila[0]).toBe("AR-08");
    expect(fila[4]).toBe(20);
    expect(fila[5]).toMatchObject({ hyperlink: expect.stringContaining("maps.google.com") });
  });

  it("escribe una hoja de novedades aunque no haya alertas", async () => {
    const workbook = await leer(await buildJornadaWorkbook(dia({ alertas: [] }), { generatedAt: new Date() }));
    const hoja = workbook.getWorksheet("Para revisar")!;
    expect(String(hoja.getCell(2, 1).value)).toContain("Sin novedades");
  });

  it("avisa en el archivo cuando el día quedó truncado", async () => {
    const workbook = await leer(await buildJornadaWorkbook(dia({ truncado: true }), { generatedAt: new Date() }));
    const hoja = workbook.getWorksheet("Resumen del día")!;
    expect(String(hoja.getCell(6, 1).value)).toContain("totales son un piso");
  });

  it("el nombre del archivo lleva la fecha del día", () => {
    expect(nombreArchivoJornada("2026-11-20")).toBe("araucana-naves-2026-11-20.xlsx");
  });
});
