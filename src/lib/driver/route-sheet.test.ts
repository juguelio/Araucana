import ExcelJS from "exceljs";
import { whatsappLink } from "@/lib/airport/route-order";
import { describe, expect, it } from "vitest";
import {
  buildRouteSheet,
  buildRouteSheetWorkbook,
  normalizeRouteSheetStops,
  ROUTE_SHEET_COLUMNS,
  routeSheetFileName,
  routeSheetRow,
  type RouteSheetInput,
  type RouteSheetReservationInput
} from "./route-sheet";

const reserva = (over: Partial<RouteSheetReservationInput> = {}): RouteSheetReservationInput => ({
  ticketCode: "TK-0001",
  passengerCount: 1,
  dropoffStop: null,
  referredBy: null,
  totalCents: 1500000,
  currency: "ARS",
  paymentStatus: null,
  passenger: {
    firstName: "Ana",
    lastName: "Pérez",
    documentType: "DNI",
    documentId: "30111222",
    phone: "+5492944123456",
    email: "ana@example.com"
  },
  ...over
});

const salida = (over: Partial<RouteSheetInput> = {}): RouteSheetInput => ({
  scheduleId: "sch-1",
  // 12:00Z = 09:00 en San Martín de los Andes.
  departureAt: new Date("2026-11-20T12:00:00.000Z"),
  arrivalAt: new Date("2026-11-20T14:30:00.000Z"),
  status: "OPEN",
  route: {
    from: "San Martín de los Andes",
    to: "Villa La Angostura",
    via: "Ruta 40",
    stops: [
      { name: "Crucero", minutes: 20, note: null },
      { name: "Villa La Angostura", minutes: 150, note: null }
    ]
  },
  vehicle: { name: "Sprinter 1", licensePlate: "AF123BC" },
  reservations: [reserva()],
  ...over
});

describe("planilla del chofer de una salida (issue #136)", () => {
  it("arma la hoja con la ruta, la hora de salida y la nave", () => {
    const sheet = buildRouteSheet(salida());

    expect(sheet.date).toBe("2026-11-20");
    expect(sheet.heading).toBe("San Martín de los Andes → Villa La Angostura · sale 09:00 · llega 11:30");
    expect(sheet.vehicle).toBe("Sprinter 1 (AF123BC)");
    expect(sheet.passengers).toHaveLength(1);
  });

  it("ordena por la secuencia de paradas de la ruta y deja al final al pasajero sin parada", () => {
    const sheet = buildRouteSheet(
      salida({
        reservations: [
          reserva({ ticketCode: "TK-SIN", dropoffStop: null, passenger: { ...reserva().passenger, firstName: "Zoe" } }),
          reserva({ ticketCode: "TK-VLA", dropoffStop: "Villa La Angostura", passenger: { ...reserva().passenger, firstName: "Bruno" } }),
          reserva({ ticketCode: "TK-CRU", dropoffStop: "Crucero", passenger: { ...reserva().passenger, firstName: "Carla" } })
        ]
      })
    );

    expect(sheet.passengers.map((p) => p.code)).toEqual(["TK-CRU", "TK-VLA", "TK-SIN"]);
  });

  it("con coordenadas en las paradas encadena el recorrido, igual que la hoja del aeropuerto", () => {
    const sheet = buildRouteSheet(
      salida({
        route: {
          from: "San Martín de los Andes",
          to: "Villa La Angostura",
          via: "Ruta 40",
          stops: [
            { name: "Cerca", minutes: 10, latitude: -40.07, longitude: -71.13 },
            { name: "Lejos", minutes: 120, latitude: -40.5, longitude: -71.5 },
            { name: "Medio", minutes: 60, latitude: -40.05, longitude: -71.02 }
          ]
        },
        reservations: [
          reserva({ ticketCode: "TK-LEJOS", dropoffStop: "Lejos" }),
          reserva({ ticketCode: "TK-MEDIO", dropoffStop: "Medio" })
        ]
      })
    );

    // Desde el aeropuerto de Chapelco: «Cerca» queda primero y después «Medio» antes que «Lejos».
    expect(sheet.passengers.map((p) => p.code)).toEqual(["TK-MEDIO", "TK-LEJOS"]);
  });

  it("una salida sin pasajeros no rompe la hoja: sale vacía con los totales en cero", async () => {
    const sheet = buildRouteSheet(salida({ reservations: [] }));

    expect(sheet.passengers).toEqual([]);
    expect(sheet.totalCents).toBe(0);
    expect(sheet.totalSeats).toBe(0);

    const workbook = await buildRouteSheetWorkbook(sheet, { generatedAt: new Date("2026-11-14T12:00:00.000Z") });
    expect(workbook.byteLength).toBeGreaterThan(0);
  });

  it("la columna «Derivado por» está en su lugar y la fila respeta el orden de columnas", () => {
    const sheet = buildRouteSheet(
      salida({ reservations: [reserva({ referredBy: "Agencia Los Andes", dropoffStop: "Crucero" })] })
    );
    const fila = routeSheetRow(sheet.passengers[0]);

    expect(ROUTE_SHEET_COLUMNS[3]).toBe("Parada");
    expect(ROUTE_SHEET_COLUMNS[4]).toBe("Derivado por");
    expect(fila).toHaveLength(ROUTE_SHEET_COLUMNS.length);
    expect(fila[3]).toBe("Crucero");
    expect(fila[4]).toBe("Agencia Los Andes");
  });

  it("imprime el código del ticket, no el de la reserva, y no inventa uno si falta", () => {
    const conTicket = buildRouteSheet(salida());
    const sinTicket = buildRouteSheet(salida({ reservations: [reserva({ ticketCode: null })] }));

    expect(conTicket.passengers[0].code).toBe("TK-0001");
    expect(sinTicket.passengers[0].code).toBe("Sin ticket");
  });

  it("el pago pendiente se lee «Cobrar» y el aprobado «Pagado»", () => {
    const pendiente = buildRouteSheet(salida());
    const pagado = buildRouteSheet(salida({ reservations: [reserva({ paymentStatus: "APPROVED" })] }));

    expect(pendiente.passengers[0].payment.startsWith("Cobrar")).toBe(true);
    expect(pagado.passengers[0].payment.startsWith("Pagado")).toBe(true);
  });

  it("normaliza las paradas del JSON sin inventar nombres ni coordenadas", () => {
    const stops = normalizeRouteSheetStops([
      { name: " Crucero ", minutes: 20 },
      { name: "", minutes: 10 },
      null,
      { name: "Sin minutos" }
    ]);

    expect(stops).toEqual([
      { name: "Crucero", minutes: 20, latitude: null, longitude: null },
      { name: "Sin minutos", minutes: null, latitude: null, longitude: null }
    ]);
  });

  it("el nombre del archivo lleva la ruta y la fecha de la salida", () => {
    const sheet = buildRouteSheet(salida());

    expect(routeSheetFileName(sheet)).toBe("planilla-salida-san-martin-de-los-andes-villa-la-angostura-2026-11-20.xlsx");
  });

  it("el Excel del chofer trae el WhatsApp como hipervínculo, no como texto suelto", async () => {
    // El teléfono se arma por partes: copiar uno de una salida de herramientas se lleva los asteriscos
    // con los que se redactan los números.
    const telefono = ["+549", "2944", "123456"].join("");
    const base = reserva();
    const sheet = buildRouteSheet(
      salida({
        reservations: [reserva({ passenger: { ...base.passenger, phone: telefono } })]
      })
    );

    const buffer = await buildRouteSheetWorkbook(sheet, { generatedAt: new Date("2026-11-14T12:00:00.000Z") });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const page = workbook.worksheets[0];
    const columnaContacto = ROUTE_SHEET_COLUMNS.indexOf("Contacto") + 1;
    let celdaContacto: ExcelJS.Cell | null = null;
    page.eachRow((fila) => {
      if (String(fila.getCell(1).value ?? "").includes("Ana Pérez")) celdaContacto = fila.getCell(columnaContacto);
    });

    expect(celdaContacto).not.toBeNull();
    expect(celdaContacto!.value).toMatchObject({
      text: telefono,
      hyperlink: "https://wa.me/5492944123456"
    });
  });

  it("un número incompleto no genera link", () => {
    expect(whatsappLink("123")).toBeNull();
    expect(whatsappLink("")).toBeNull();
  });
});
