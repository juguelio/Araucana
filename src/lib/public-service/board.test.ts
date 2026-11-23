import { describe, expect, it } from "vitest";
import type { AdminScheduleRowDto } from "@/lib/booking/types";
import { agruparPorTerminal, resumenDeSalidas, salidasDeTerminal, terminalDe } from "./board";

function salida(overrides: Partial<AdminScheduleRowDto>): AdminScheduleRowDto {
  return {
    id: "s1",
    routeId: "r1",
    vehicleId: "v1",
    vehicleName: "Iveco Daily 15",
    vehiclePlate: "AD884ZZ",
    vehicleInternalNumber: "AR-08",
    route: "San Martin de los Andes -> Villa Traful",
    from: "San Martin de los Andes",
    to: "Villa Traful",
    departureAt: new Date("2026-11-24T11:30:00Z"),
    arrivalAt: new Date("2026-11-24T13:00:00Z"),
    status: "OPEN",
    availableSeats: 4,
    totalSeats: 15,
    bookingMode: "SEATED",
    ...overrides
  } as AdminScheduleRowDto;
}

describe("servicio público", () => {
  it("reconoce las tres terminales aunque el nombre venga con mayúsculas o sin tilde", () => {
    expect(terminalDe("San Martin de los Andes")).toBe("sma");
    expect(terminalDe("SAN MARTÍN DE LOS ANDES")).toBe("sma");
    expect(terminalDe("Villa Traful")).toBe("traful");
    expect(terminalDe("villa la angostura")).toBe("vla");
    expect(terminalDe("Hua Hum")).toBeNull();
  });

  it("deja afuera lo que no es servicio público", () => {
    const rows = [
      salida({ id: "ok" }),
      salida({ id: "airport", bookingMode: "AIRPORT", from: "San Martin de los Andes" }),
      salida({ id: "especial", bookingMode: "REGULAR", from: "Junin de los Andes" })
    ];
    expect(salidasDeTerminal(rows).map((fila) => fila.id)).toEqual(["ok"]);
  });

  it("calcula ocupados, libres y el resumen del día", () => {
    const filas = salidasDeTerminal([
      salida({ id: "a", availableSeats: 4, totalSeats: 15 }),
      salida({ id: "b", availableSeats: 0, totalSeats: 19 })
    ]);
    expect(filas[0]).toMatchObject({ ocupados: 11, libres: 4, capacidad: 15, estadoLabel: "Programada" });
    expect(resumenDeSalidas(filas)).toEqual({ salidas: 2, pasajeros: 30, libres: 4 });
  });

  it("agrupa cada salida en su terminal de origen", () => {
    const rows = [
      salida({ id: "sma", from: "San Martin de los Andes" }),
      salida({ id: "vla", from: "Villa La Angostura" }),
      salida({ id: "traful", from: "Villa Traful" })
    ];
    const grupos = agruparPorTerminal(salidasDeTerminal(rows), rows);
    expect(grupos.map((grupo) => [grupo.clave, grupo.salidas.length])).toEqual([
      ["sma", 1],
      ["traful", 1],
      ["vla", 1]
    ]);
  });
});
