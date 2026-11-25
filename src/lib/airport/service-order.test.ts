import { describe, expect, it } from "vitest";
import {
  alojamientoDelPasajero,
  blockTimeLabel,
  buildServiceOrderBlocks,
  buildServiceOrderWorkbook,
  filtrarPorNave,
  inicioDeRecorrida,
  referenciaDeLaOrden,
  SIN_NAVE,
  tituloDelTotal,
  lineasDeTexto,
  serviceOrderFileName,
  documentoDelPasajero,
  fechaDeLaOrden,
  paymentLabel,
  recortarDireccion,
  SERVICE_ORDER_COLUMNS,
  serviceOrderRow,
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

  it("la hoja conserva el inicio guardado cuando cambia el horario de despegue", () => {
    const blocks = buildServiceOrderBlocks([
      reserva({
        flight: vuelo({
          scheduledAt: new Date("2026-11-12T18:15:00Z"),
          pickupStartInitialAt: new Date("2026-11-12T15:30:00Z"),
          // 17:15 en Salta.
          estimatedAt: new Date("2026-11-12T20:15:00Z")
        })
      })
    ]);

    expect(blocks[0].flightAt.toISOString()).toBe("2026-11-12T20:15:00.000Z");
    expect(blocks[0].operationAt.toISOString()).toBe("2026-11-12T15:30:00.000Z");
    expect(blockTimeLabel(blocks[0])).toBe("OUT 1671 · recorrida 12:30 · despegue 17:15 (programado 15:15)");
  });

  it("la hora coordinada a mano manda sobre la demora sólo para la recorrida", () => {
    const coordinada = new Date("2026-11-12T16:00:00Z");
    const blocks = buildServiceOrderBlocks([
      reserva({
        flight: vuelo({
          estimatedAt: new Date("2026-11-12T20:15:00Z"),
          pickupStartOverrideAt: coordinada
        })
      })
    ]);

    // 13:00 en Salta: la recorrida coordinada; el despegue sigue siendo el estimado de la aerolínea.
    expect(blocks[0].operationAt).toBe(coordinada);
    expect(blockTimeLabel(blocks[0])).toBe("OUT 1671 · recorrida 13:00 · despegue 17:15 (programado 15:15)");
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

  /** Issue #268: el alojamiento cargado como texto, sin coordenadas, se imprime igual para el chofer. */
  it("imprime el alojamiento cargado como texto aunque no tenga punto", () => {
    const [block] = buildServiceOrderBlocks([reserva({
      pickupName: null,
      pickupAddress: "Hostal del Esquiador",
      pickupLatitude: null,
      pickupLongitude: null
    })]);

    expect(serviceOrderRow(block.passengers[0])[3]).toBe("Hostal del Esquiador");
    // Sin punto no se le inventa una ubicación: va al final de la recorrida.
    expect(block.passengers[0].pickup).toBeNull();
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

  describe("recorrida desde la oficina", () => {
    const oficina = { latitude: -40.158, longitude: -71.353 };
    const retiro = (code: string, latitude: number, longitude: number, routePosition?: number) => reserva({
      code, passengerCount: 1, pickupLatitude: latitude, pickupLongitude: longitude, routePosition
    });

    it("la oficina participa del cálculo y el retiro en la sucursal va primero", () => {
      const [orden] = buildServiceOrderBlocks([
        retiro("oeste", -40.161, -71.36), retiro("este", -40.15, -71.337),
        retiro("oficina", oficina.latitude, oficina.longitude), reserva({ code: "sin-punto" })
      ], { oficina });
      expect(orden.passengers.map((p) => p.code)).toEqual(["oficina", "oeste", "este", "sin-punto"]);
      expect(orden.manualOrder).toBe(false);
    });

    it("conserva el orden manual y optimiza lo nuevo desde el último retiro fijado", () => {
      const [orden] = buildServiceOrderBlocks([
        retiro("fijada-2", -40.161, -71.36, 1), retiro("este", -40.15, -71.337),
        retiro("fijada-1", -40.13, -71.30, 0), retiro("oficina", oficina.latitude, oficina.longitude)
      ], { oficina });
      expect(orden.passengers.map((p) => p.code)).toEqual(["fijada-1", "fijada-2", "oficina", "este"]);
      expect(orden.manualOrder).toBe(true);
    });

    it("cada nave mantiene sus pasajeros elegidos y calcula su propio trayecto desde la oficina", () => {
      const vehicles = [
        { assignmentId: "a", vehicleId: "a", name: "A", seats: 4, driver: null },
        { assignmentId: "b", vehicleId: "b", name: "B", seats: 4, driver: null }
      ];
      const reservas = [retiro("este", -40.15, -71.337), retiro("oficina", oficina.latitude, oficina.longitude), retiro("otra", -40.13, -71.30)]
        .map((r) => ({ ...r, assignmentId: r.code === "otra" ? "b" : "a", flight: vuelo({ vehicles }) }));
      const ordenes = buildServiceOrderBlocks(reservas, { oficina });
      expect(ordenes.map((o) => o.passengers.map((p) => p.code))).toEqual([["oficina", "este"], ["otra"]]);
    });
  });

  it.each([
    [null, "[ ] Efectivo\n[ ] Transferencia"],
    ["Efectivo", "[x] Efectivo\n[ ] Transferencia"],
    ["transferencia", "[ ] Efectivo\n[x] Transferencia"],
    ["Tarjeta", "[ ] Efectivo\n[ ] Transferencia\nOtro: Tarjeta"]
  ])("la forma de pago %s queda en la orden y en los casilleros del Excel", async (paymentMethod, esperado) => {
    const ExcelJS = (await import("exceljs")).default;
    const blocks = buildServiceOrderBlocks([reserva({ paymentMethod })]);
    const fila = serviceOrderRow(blocks[0].passengers[0]);
    expect(fila[SERVICE_ORDER_COLUMNS.indexOf("Forma de pago")]).toBe(paymentMethod ?? "");
    expect(blocks[0].passengers[0].payment).toMatch(/^Cobrar/);
    const libro = new ExcelJS.Workbook();
    const buffer = await buildServiceOrderWorkbook({ date: "2026-11-12", generatedAt: new Date() }, blocks);
    await libro.xlsx.load(buffer as unknown as Parameters<typeof libro.xlsx.load>[0]);
    const hoja = libro.getWorksheet("Orden de servicio")!;
    expect(hoja.getCell("H5").value).toBe("Forma de pago");
    let encontrado = false;
    hoja.eachRow((renglon) => {
      if (String(renglon.getCell(1).value ?? "").includes("Faur")) {
        encontrado = true;
        expect(renglon.getCell(8).value).toBe(esperado);
        expect(renglon.height).toBeGreaterThanOrEqual(paymentMethod === "Tarjeta" ? 42 : 30);
      }
    });
    expect(encontrado).toBe(true);
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

  describe("vista en pantalla (issue #118)", () => {
    it("arma las celdas en el mismo orden que la hoja y el Excel", () => {
      const derivada = reserva({ code: "ARA-9", referredBy: "Agencia Los Andes" });
      const [block] = buildServiceOrderBlocks([derivada]);
      const fila = serviceOrderRow(block.passengers[0]);

      // Si alguien agrega una columna y no toca `serviceOrderRow`, la pantalla y el papel se separan.
      expect(fila).toHaveLength(SERVICE_ORDER_COLUMNS.length);
      const porColumna = Object.fromEntries(SERVICE_ORDER_COLUMNS.map((columna, indice) => [columna, fila[indice]]));
      expect(porColumna["Pasajero"]).toContain("Faur");
      expect(porColumna["Cant"]).toBe("5");
      expect(porColumna["DNI"]).toBe("30111222");
      expect(porColumna["Alojamiento"]).toContain(block.passengers[0].lodging);
      expect(porColumna["Derivado por"]).toBe("Agencia Los Andes");
      expect(porColumna["Pago"]).toMatch(/Cobrar|Pagado/);
      expect(porColumna["Contacto"]).toBeTruthy();
    });

    it("deja «Derivado por» vacío cuando la venta fue directa", () => {
      const directa = reserva({ code: "ARA-10", referredBy: null });
      const [block] = buildServiceOrderBlocks([directa]);
      const fila = serviceOrderRow(block.passengers[0]);
      const indice = SERVICE_ORDER_COLUMNS.indexOf("Derivado por" as (typeof SERVICE_ORDER_COLUMNS)[number]);

      expect(fila[indice]).toBe("");
    });
  });

  describe("una orden por nave", () => {
    const naves = [
      { assignmentId: "asig-a", vehicleId: "nave-a", name: "Sprinter 1910", seats: 4, driver: "Juan" },
      { assignmentId: "asig-b", vehicleId: "nave-b", name: "Master 243", seats: 4, driver: null }
    ];
    // Del aeropuerto hacia el centro: la ARA-1 queda más cerca que la ARA-2, y ésta más que la ARA-3.
    const cerca = { pickupLatitude: -40.08, pickupLongitude: -71.15 };
    const medio = { pickupLatitude: -40.12, pickupLongitude: -71.3 };
    const lejos = { pickupLatitude: -40.157, pickupLongitude: -71.353 };
    const conNaves = (extra: Partial<ServiceOrderReservationInput>) =>
      reserva({ flight: vuelo({ vehicles: naves }), ...extra });

    it("con una sola nave el vuelo sigue siendo una orden y lleva la nave en el rótulo", () => {
      const blocks = buildServiceOrderBlocks([reserva({ flight: vuelo({ vehicles: [naves[0]] }) })]);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].vehicle?.name).toBe("Sprinter 1910");
      expect(blockTimeLabel(blocks[0])).toContain("Sprinter 1910 · Juan");
      expect(referenciaDeLaOrden(blocks[0])).toEqual({ flight: "vuelo-1671", vehicle: null });
    });

    it("con dos naves reparte por capacidad en el orden de la recorrida, sin partir reservas", () => {
      const blocks = buildServiceOrderBlocks([
        conNaves({ code: "ARA-3", passengerCount: 2, ...lejos }),
        conNaves({ code: "ARA-1", passengerCount: 3, ...cerca }),
        conNaves({ code: "ARA-2", passengerCount: 2, ...medio })
      ]);

      expect(blocks.map((block) => block.vehicle?.name)).toEqual(["Sprinter 1910", "Master 243"]);
      // La ARA-2 no entra en los 4 lugares de la primera (3 + 2): pasa entera a la segunda.
      expect(blocks[0].passengers.map((p) => p.code)).toEqual(["ARA-1"]);
      // Es una partida: la recorrida termina en el aeropuerto, así que arranca por el más lejano.
      expect(blocks[1].passengers.map((p) => p.code)).toEqual(["ARA-3", "ARA-2"]);
      expect(blocks[0].totalCents + blocks[1].totalCents).toBe(3 * 475000);
      expect(tituloDelTotal(blocks[1])).toBe("Total OUT 1671 · Master 243");
    });

    it("lo que no entra en ninguna nave queda en una orden «sin nave», no se pierde", () => {
      const blocks = buildServiceOrderBlocks([
        conNaves({ code: "ARA-1", passengerCount: 4, ...cerca }),
        conNaves({ code: "ARA-2", passengerCount: 4, ...medio }),
        conNaves({ code: "ARA-3", passengerCount: 1, ...lejos })
      ]);

      expect(blocks).toHaveLength(3);
      expect(blocks[2].vehicle).toBeNull();
      expect(blocks[2].passengers.map((p) => p.code)).toEqual(["ARA-3"]);
      expect(blockTimeLabel(blocks[2])).toContain("sin nave asignada");
      expect(referenciaDeLaOrden(blocks[2])).toEqual({ flight: "vuelo-1671", vehicle: SIN_NAVE });
    });

    it("respeta la nave y el orden elegidos a mano, y lo nuevo cae al final", () => {
      const blocks = buildServiceOrderBlocks([
        conNaves({ code: "ARA-1", passengerCount: 1, ...cerca, assignmentId: "asig-b", routePosition: 1 }),
        conNaves({ code: "ARA-3", passengerCount: 1, ...lejos, assignmentId: "asig-b", routePosition: 0 }),
        conNaves({ code: "ARA-2", passengerCount: 1, ...medio }),
        conNaves({ code: "ARA-4", passengerCount: 1, ...cerca })
      ], { incluirVacias: true });

      const [primera, segunda] = blocks;
      // La Master ya pasa por la zona de los nuevos y tiene lugar: suben ahí, después de los fijados, en
      // vez de mandar a la Sprinter a hacer otro viaje al mismo lugar.
      expect(primera.vehicle?.assignmentId).toBe("asig-a");
      expect(primera.passengers).toEqual([]);
      // Los fijados a mano, en su orden; después los nuevos, del más lejano al más cercano al aeropuerto.
      expect(segunda.passengers.map((p) => p.code)).toEqual(["ARA-3", "ARA-1", "ARA-2", "ARA-4"]);
      expect(segunda.manualOrder).toBe(true);
    });

    it("en una partida el orden sugerido va del más lejano al aeropuerto; en un arribo, del más cercano", () => {
      const sinNave = (extra: Partial<ServiceOrderReservationInput>, direction: string) =>
        reserva({ flight: vuelo({ vehicles: [naves[0]], direction }), direction, ...extra });
      const pasajeros = (direction: string) => buildServiceOrderBlocks([
        sinNave({ code: "ARA-1", passengerCount: 1, ...cerca }, direction),
        sinNave({ code: "ARA-SIN", passengerCount: 1 }, direction),
        sinNave({ code: "ARA-3", passengerCount: 1, ...lejos }, direction),
        sinNave({ code: "ARA-2", passengerCount: 1, ...medio }, direction)
      ])[0].passengers.map((p) => p.code);
      // El que no está ubicado en el mapa va al final en los dos casos.
      expect(pasajeros("DEPARTURE")).toEqual(["ARA-3", "ARA-2", "ARA-1", "ARA-SIN"]);
      expect(pasajeros("ARRIVAL")).toEqual(["ARA-1", "ARA-2", "ARA-3", "ARA-SIN"]);
    });

    it("ignora la nave guardada si ya no es del vuelo", () => {
      const blocks = buildServiceOrderBlocks([conNaves({ code: "ARA-1", passengerCount: 1, assignmentId: "de-otro-vuelo" })]);

      expect(blocks[0].vehicle?.assignmentId).toBe("asig-a");
      expect(blocks[0].passengers.map((p) => p.code)).toEqual(["ARA-1"]);
    });

    it("las naves vacías sólo aparecen cuando se piden (el panel las usa para soltar gente)", () => {
      const reservas = [conNaves({ code: "ARA-1", passengerCount: 1 })];

      expect(buildServiceOrderBlocks(reservas)).toHaveLength(1);
      expect(buildServiceOrderBlocks(reservas, { incluirVacias: true }).map((b) => b.vehicle?.name)).toEqual([
        "Sprinter 1910",
        "Master 243"
      ]);
    });

    it("filtra la orden de una nave para la descarga y el link del chofer", () => {
      const blocks = buildServiceOrderBlocks([
        conNaves({ code: "ARA-1", passengerCount: 4 }),
        conNaves({ code: "ARA-2", passengerCount: 4 })
      ]);

      expect(filtrarPorNave(blocks, null)).toHaveLength(2);
      expect(filtrarPorNave(blocks, "asig-b").map((b) => b.passengers[0].code)).toEqual(["ARA-2"]);
      expect(filtrarPorNave(blocks, "otra")).toEqual([]);
    });
  });

  describe("inicio de recorrida remarcado", () => {
    it("las partidas dan la hora de inicio aparte y el rótulo puede omitirla", () => {
      const [block] = buildServiceOrderBlocks([reserva()]);

      expect(inicioDeRecorrida(block)).toBe("12:45");
      expect(blockTimeLabel(block)).toContain("recorrida 12:45");
      expect(blockTimeLabel(block, { sinRecorrida: true })).toBe("OUT 1671 · despegue 15:15");
    });

    it("los arribos no tienen recorrida", () => {
      const [block] = buildServiceOrderBlocks([
        reserva({ direction: "ARRIVAL", flight: vuelo({ direction: "ARRIVAL", number: "1670" }) })
      ]);

      expect(inicioDeRecorrida(block)).toBeNull();
    });

    it("el Excel lleva un renglón «INICIO DE RECORRIDA» en las partidas", async () => {
      const ExcelJS = (await import("exceljs")).default;
      const buffer = await buildServiceOrderWorkbook(
        { date: "2026-11-12", generatedAt: new Date("2026-11-12T10:00:00Z") },
        buildServiceOrderBlocks([reserva()])
      );
      const libro = new ExcelJS.Workbook();
      await libro.xlsx.load(buffer as unknown as ArrayBuffer);
      const textos: string[] = [];
      libro.worksheets[0].eachRow((fila) => textos.push(String(fila.getCell(1).value ?? "")));

      expect(textos).toContain("INICIO DE RECORRIDA 12:45");
    });
  });
});

it("inicia en Paihuén 15 minutos antes del horario coordinado, incluso con otra parada fijada", () => {
  const flight = vuelo({ pickupStartOverrideAt: new Date("2026-11-12T15:00:00Z") });
  const [block] = buildServiceOrderBlocks([
    reserva({ flight, code: "oficina", routePosition: 0 }),
    reserva({ flight, code: "hotel", pickupName: null, pickupAddress: "Paihuen, Ruta Nac. 40 Ex. 234 km 78" })
  ]);
  expect(block.passengers.map(p => p.code)).toEqual(["hotel", "oficina"]);
  expect(block.operationAt.toISOString()).toBe("2026-11-12T14:45:00.000Z");
});

it("deja a todos los pasajeros de Paihuén al final al llegar del aeropuerto", () => {
  const flight = vuelo({ direction: "ARRIVAL" });
  const [block] = buildServiceOrderBlocks([
    reserva({ flight, code: "hotel1", pickupName: "Paihuén", routePosition: 0 }),
    reserva({ flight, code: "centro", routePosition: 1 }),
    reserva({ flight, code: "hotel2", pickupName: "Paihuen Resort de Montaña" }),
    reserva({ flight, code: "barrio" })
  ]);
  expect(block.passengers.map(p => p.code)).toEqual(["centro", "barrio", "hotel1", "hotel2"]);
  expect(block.operationAt).toEqual(flight.scheduledAt);
});
