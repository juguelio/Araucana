import { describe, expect, it } from "vitest";
import { formatoHoras, resumenPorChofer } from "./workdays";

const salida = (overrides: Partial<Parameters<typeof resumenPorChofer>[0][number]>) => ({
  driverId: "d1",
  driverName: "Juan Muñoz",
  departureAt: new Date("2026-11-03T11:30:00Z"),
  arrivalAt: new Date("2026-11-03T13:00:00Z"),
  ...overrides
});

describe("días trabajados de los choferes", () => {
  it("cuenta días distintos, salidas y horas", () => {
    const resumen = resumenPorChofer([
      salida({}),
      salida({ departureAt: new Date("2026-11-03T20:00:00Z"), arrivalAt: new Date("2026-11-03T21:30:00Z") }),
      salida({ departureAt: new Date("2026-11-04T11:30:00Z"), arrivalAt: new Date("2026-11-04T13:00:00Z") })
    ]);

    expect(resumen).toHaveLength(1);
    expect(resumen[0]).toMatchObject({
      driverId: "d1",
      dias: ["2026-11-03", "2026-11-04"],
      salidas: 3,
      horas: 4.5
    });
    expect(formatoHoras(resumen[0].horas)).toBe("4,5 h");
  });

  it("ignora salidas sin chofer y ordena por días trabajados", () => {
    const resumen = resumenPorChofer([
      salida({ driverId: null, driverName: null }),
      salida({ driverId: "d2", driverName: "María Quiroga" }),
      salida({ driverId: "d1", driverName: "Juan Muñoz" }),
      salida({ driverId: "d1", driverName: "Juan Muñoz", departureAt: new Date("2026-11-04T11:30:00Z") })
    ]);

    expect(resumen.map((chofer) => chofer.driverId)).toEqual(["d1", "d2"]);
  });

  it("usa el día argentino de la salida", () => {
    // 01:30 UTC del 4 es todavía el 3 en Argentina (-03:00).
    const resumen = resumenPorChofer([
      salida({ departureAt: new Date("2026-11-04T01:30:00Z"), arrivalAt: new Date("2026-11-04T03:00:00Z") })
    ]);
    expect(resumen[0].dias).toEqual(["2026-11-03"]);
    expect(resumen[0].primerHora).toBe("22:30");
  });
});
