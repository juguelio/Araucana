import { describe, expect, it } from "vitest";
import {
  alojamientoDelPasajero,
  blockTimeLabel,
  buildServiceOrderBlocks,
  buildServiceOrderWorkbook,
  lineasDeTexto,
  serviceOrderFileName,
  documentoDelPasajero,
  fechaDeLaOrden,
  paymentLabel,
  recortarDireccion,
  type ServiceOrderReservationInput
} from "./service-order";

/**
 * Los horarios del ejemplo son los del papel que mandó el cliente (issue #74):
 * recorrida 12:30 y despegue 15:15 para el OUT 1671, llegada 14:10 para el 1670.
 */
const vuelo = (extra: Partial<ServiceOrderReservationInput["flight"] & object> = {}) => ({
  id: "vuelo-1671",
  number: "1671",
  airline: "AR",
  direction: "DEPARTURE",
  // 15:15 en Salta = 18:15Z.
  scheduledAt: new Date("2026-11-12T18:15:00Z"),
  estimatedAt: null,
  pickupStartOverrideAt: null,
  ...extra
});

const reserva = (extra: Partial<ServiceOrderReservationInput> = {}): ServiceOrderReservationInput => ({
  code: "ARA-1",
  totalCents: 475000,
  currency: "ARS",
  passengerCount: 5,
  paymentStatus: "PENDING",
  direction: "DEPARTURE",
  flightNumber: "1671",
  pickupName: "Serena - Casa de Montaña",
  pickupAddress: "Los Notros 123",
  pickupNotes: null,
  passenger: {
    firstName: "Matías",
    lastName: "Faur",
    phone: "11 5755-2959",
    documentType: "DNI",
    documentId: "30111222"
  },
  flight: vuelo(),
  ...extra
});

describe("orden de servicio del aeropuerto", () => {
  it("arma un bloque por vuelo con el rótulo del papel", () => {
    const blocks = buildServiceOrderBlocks([reserva()]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].heading).toBe("OUT");
    // 12:45 en Salta: las dos horas y media de recorrida antes de un despegue de las 15:15.
    expect(blockTimeLabel(blocks[0])).toBe("OUT 1671 · recorrida 12:45 · despegue 15:15");
  });

  it("los arribos se rotulan «Llega» con la hora del vuelo, no con una recorrida", () => {
    const blocks = buildServiceOrderBlocks([
      reserva({
        code: "ARA-2",
        direction: "ARRIVAL",
        flightNumber: "1670",
        flight: vuelo({
          id: "vuelo-1670",
          number: "1670",
          direction: "ARRIVAL",
          // 14:10 en Salta = 17:10Z.
          scheduledAt: new Date("2026-11-12T17:10:00Z")
        })
      })
    ]);

    expect(blocks[0].heading).toBe("Llega");
    expect(blockTimeLabel(blocks[0])).toBe("Llega 1670 · llega 14:10");
  });

  it("si el vuelo viene demorado avisa la estima sin dejar de decir el horario programado", () => {
    const blocks = buildServiceOrderBlocks([
      reserva({
        direction: "ARRIVAL",
        flight: vuelo({
          direction: "ARRIVAL",
          scheduledAt: new Date("2026-11-12T17:10:00Z"),
          // 14:40 en Salta.
          estimatedAt: new Date("2026-11-12T17:40:00Z")
        })
      })
    ]);

    expect(blocks[0].operationAt.toISOString()).toBe("2026-11-12T17:40:00.000Z");
    expect(blockTimeLabel(blocks[0])).toBe("Llega 1671 · llega 14:40 (programado 14:10)");
  });

  it("ordena la recorrida de las partidas antes de los arribos y suma por bloque", () => {
    const blocks = buildServiceOrderBlocks([
      reserva({
        code: "ARA-2",
        direction: "ARRIVAL",
        totalCents: 190000,
        flight: vuelo({
          id: "vuelo-1670",
          number: "1670",
          direction: "ARRIVAL",
          scheduledAt: new Date("2026-11-12T17:10:00Z")
        })
      }),
      reserva({ code: "ARA-1" }),
      reserva({ code: "ARA-3", totalCents: 200000 })
    ]);

    expect(blocks.map((block) => block.heading)).toEqual(["OUT", "Llega"]);
    // OUT: 475.000 + 200.000 de las dos reservas del mismo vuelo. Llega: la suya sola.
    expect(blocks[0].totalCents).toBe(675000);
    expect(blocks[1].totalCents).toBe(190000);
    expect(blocks[0].passengers).toHaveLength(2);
  });

  it("dos reservas del mismo vuelo comparten bloque aunque el vuelo no esté cargado", () => {
    const blocks = buildServiceOrderBlocks([
      reserva({ flight: null, paymentStatus: null }),
      reserva({ code: "ARA-9", flight: null })
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].passengers).toHaveLength(2);
    expect(blocks[0].totalCents).toBe(950000);
  });

  it("un día sin reservas no arma bloques", () => {
    expect(buildServiceOrderBlocks([])).toEqual([]);
  });

  it("imprime el pago como lo lee el chofer", () => {
    expect(paymentLabel("PENDING", 475000)).toMatch(/^Cobrar/);
    expect(paymentLabel("APPROVED", 475000)).toMatch(/^Pagado/);
    expect(paymentLabel(null, 95000)).toMatch(/^Cobrar/);
    expect(paymentLabel("REJECTED", 95000)).toMatch(/^Rechazado/);
  });

  it("el DNI va solo y el pasaporte se aclara", () => {
    expect(documentoDelPasajero("DNI", "30111222")).toBe("30111222");
    expect(documentoDelPasajero("PAS", "AAF123456")).toBe("PAS AAF123456");
  });

  it("el alojamiento usa el lugar y la dirección que escribió el pasajero", () => {
    expect(alojamientoDelPasajero("Patagonia Plaza", "Gral Roca 1355")).toEqual({
      lodging: "Patagonia Plaza",
      lodgingDetail: "Gral Roca 1355"
    });
    expect(alojamientoDelPasajero(null, "Gral Roca 1355")).toEqual({
      lodging: "Gral Roca 1355",
      lodgingDetail: null
    });
    expect(alojamientoDelPasajero(null, null)).toEqual({ lodging: "—", lodgingDetail: null });
  });

  it("recorta la cola administrativa que agrega el buscador", () => {
    expect(
      recortarDireccion(
        "Hotel el Viejo Esquiador, 1242, Avenida San Martín, Cantera, Centro, Municipio de San Martín de los Andes, Departamento Lácar, Neuquén, 8370, Argentina"
      )
    ).toBe("Hotel el Viejo Esquiador, 1242, Avenida San Martín, Cantera, Centro");
    expect(
      recortarDireccion("AV DAMIAN ELORRIAGA (ESQUINA LOS SAUCOS), San Martín de los Andes, Lácar, Neuquén")
    ).toBe("AV DAMIAN ELORRIAGA (ESQUINA LOS SAUCOS), San Martín de los Andes");
    expect(recortarDireccion("Rudecindo Roca 1066")).toBe("Rudecindo Roca 1066");
    expect(recortarDireccion("Municipio de San Martín de los Andes")).toBe("Municipio de San Martín de los Andes");
  });

  it("el nombre del archivo lleva el vuelo cuando es una hoja por servicio", () => {
    expect(serviceOrderFileName("2026-11-12")).toBe("orden-de-servicio-2026-11-12.xlsx");
    expect(serviceOrderFileName("2026-11-12", "AR 1653")).toBe("orden-de-servicio-2026-11-12-ar-1653.xlsx");
  });

  it("genera el .xlsx con el logo embebido", async () => {
    const workbook = await buildServiceOrderWorkbook(
      { date: "2026-11-12", generatedAt: new Date("2026-11-12T16:45:00Z") },
      buildServiceOrderBlocks([reserva()])
    );

    // Un .xlsx es un zip: la imagen del encabezado viaja como un archivo más del paquete.
    expect(workbook.includes(Buffer.from("xl/media/image1.png"))).toBe(true);
    expect(workbook.byteLength).toBeGreaterThan(10000);
  });

  it("lleva al chofer quién derivó la venta y deja vacío el que se vendió directo", async () => {
    const ExcelJS = (await import("exceljs")).default;
    // Nombres distintos: la hoja ordena por pasajero y el test lee la celda por el nombre.
    const conNombre = (firstName: string, lastName: string, documentId: string) => ({
      ...reserva().passenger, firstName, lastName, documentId
    });
    const derivada = reserva({ code: "ARA-2", referredBy: "Agencia Los Andes", passenger: conNombre("Matías", "Faur", "30111222") });
    const directa = reserva({ code: "ARA-3", referredBy: null, passenger: conNombre("Lucía", "Sosa", "27888999") });
    const soloEspacios = reserva({ code: "ARA-4", referredBy: "   ", passenger: conNombre("Ana", "Gómez", "33444555") });

    const blocks = buildServiceOrderBlocks([derivada, directa, soloEspacios]);
    const porCodigo = new Map(blocks[0].passengers.map((pasajero) => [pasajero.code, pasajero.referredBy]));
    expect(porCodigo.get("ARA-2")).toBe("Agencia Los Andes");
    expect(porCodigo.get("ARA-3")).toBeNull();
    // Espacios en blanco no son un origen: la celda tiene que quedar vacía, no con basura.
    expect(porCodigo.get("ARA-4")).toBeNull();

    const workbook = await buildServiceOrderWorkbook(
      { date: "2026-11-12", generatedAt: new Date("2026-11-12T16:45:00Z") },
      blocks
    );
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(workbook as unknown as Parameters<typeof libro.xlsx.load>[0]);
    const hoja = libro.getWorksheet("Orden de servicio")!;

    const derivadoPor = new Map<string, string>();
    hoja.eachRow((renglon) => {
      const nombre = String(renglon.getCell(1).value ?? "");
      for (const apellido of ["Faur", "Sosa", "Gómez"]) {
        if (nombre.includes(apellido)) derivadoPor.set(apellido, String(renglon.getCell(5).value ?? ""));
      }
    });

    expect(derivadoPor.get("Faur")).toBe("Agencia Los Andes");
    expect(derivadoPor.get("Sosa")).toBe("");
    expect(derivadoPor.get("Gómez")).toBe("");
  });

  it("calcula cuántos renglones ocupa una dirección larga", () => {
    expect(lineasDeTexto("Los Saucos 351", 30, 9.5)).toBe(1);
    // Caso real que salió cortado: 36 caracteres en la columna de 30 → dos renglones, no uno.
    expect(lineasDeTexto("Avenida Rodolfo Koessler, El Oasis", 30, 9.5)).toBe(2);
    expect(
      lineasDeTexto("Hotel el Viejo Esquiador, 1242, Avenida San Martín, Cantera, Centro", 30, 9.5)
    ).toBe(3);
    expect(lineasDeTexto("", 30, 9.5)).toBe(1);
  });

  it("la fila crece para que la dirección no se corte", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = await buildServiceOrderWorkbook(
      { date: "2026-11-12", generatedAt: new Date("2026-11-12T16:45:00Z") },
      buildServiceOrderBlocks([
        reserva({
          pickupName: "Hotel el Viejo Esquiador, 1242, Avenida San Martín, Cantera, Centro",
          pickupAddress: null
        })
      ])
    );

    const libro = new ExcelJS.Workbook();
    // Cast de tipos: @types/node y ExcelJS declaran genéricos distintos de Buffer (mismo runtime).
    await libro.xlsx.load(workbook as unknown as Parameters<typeof libro.xlsx.load>[0]);
    const hoja = libro.getWorksheet("Orden de servicio")!;

    let fila: { height: number; alojamiento: string } | null = null;
    hoja.eachRow((renglon) => {
      if (String(renglon.getCell(1).value ?? "").includes("Faur")) {
        const celda = renglon.getCell(4).value as { richText?: { text: string }[] } | string;
        const texto = typeof celda === "string" ? celda : (celda.richText ?? []).map((parte) => parte.text).join("");
        fila = { height: Number(renglon.height ?? 0), alojamiento: texto };
      }
    });

    expect(fila).not.toBeNull();
    // Tres renglones de texto: 3 × 12 + 6. Con el alto fijo de antes (18) se veía sólo la primera línea.
    expect(fila!.height).toBeGreaterThanOrEqual(42);
    expect(fila!.alojamiento).toContain("Avenida San Martín, Cantera, Centro");
  });

  it("la fecha del encabezado es el día del servicio, sin corrimiento de zona", () => {
    expect(fechaDeLaOrden("2026-02-10")).toBe("Martes 10-feb");
    expect(fechaDeLaOrden("2026-08-01")).toBe("Sábado 01-ago");
  });
});
