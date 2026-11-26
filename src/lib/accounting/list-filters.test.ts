import { describe, expect, it } from "vitest";
import { paginar } from "@/lib/admin/list-order";
import {
  COLUMNAS_DE_INGRESOS_POR_DEFECTO,
  ORDEN_DE_INGRESOS_POR_DEFECTO,
  filtrarIngresos,
  leerColumnasDeIngresos,
  leerTamanoDePagina,
  ordenarIngresos,
  periodoDeIngresos
} from "./list-filters";
import type { AccountingIncomeItem } from "./types";

function ingreso(overrides: Partial<AccountingIncomeItem> = {}): AccountingIncomeItem {
  const base: AccountingIncomeItem = {
    id: "r1",
    source: "reservation",
    code: "ARC-1",
    description: "",
    amountCents: 100_000,
    currency: "ARS",
    occurredAt: new Date("2026-11-05T10:00:00.000Z"),
    vehicleId: "v1",
    vehicleName: "Araucana 24",
    driverId: "d1",
    driverName: "Hugo",
    routeLabel: "San Martin a Chapelco",
    routeFrom: "San Martin",
    routeTo: "Chapelco",
    status: "CONFIRMED",
    paymentStatus: "APPROVED",
    ...overrides
  };
  return { ...base, description: `${base.code} · ${base.routeLabel}` };
}

describe("períodos de ingresos", () => {
  it("arma el mes, la semana (lunes a domingo), el día y el rango desde/hasta", () => {
    expect(periodoDeIngresos({ vista: "mes", month: "2026-11" }).period.label).toBe("Noviembre 2026");
    expect(periodoDeIngresos({ vista: "semana", semana: "2026-11-05" }).period.label).toBe("Semana del 02/11/2026 al 08/11/2026");
    expect(periodoDeIngresos({ vista: "dia", dia: "2026-11-05" }).period.label).toBe("05/11/2026");
    expect(periodoDeIngresos({ vista: "rango", desde: "2026-11-01", hasta: "2026-11-15" }).period.label).toBe("2026-11-01 a 2026-11-15");
  });

  it("cae en el mes actual si el parámetro no es válido y conserva los valores para los controles", () => {
    const periodo = periodoDeIngresos({ vista: "mes", month: "no-es-un-mes" });
    expect(periodo.period.from.getUTCDate()).toBe(1);
    expect(periodo.mes).toMatch(/^\d{4}-\d{2}$/);
    expect(periodo.desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(periodo.hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("filtros de ingresos", () => {
  const filas = [
    ingreso({ id: "r1", code: "ARC-1", driverName: "Hugo", routeLabel: "San Martin a Chapelco" }),
    ingreso({ id: "r2", code: "ARC-2", driverId: "d2", driverName: "Silvia", routeLabel: "Villa Traful a San Martin", amountCents: 200_000 }),
    ingreso({ id: "r3", code: "ARC-3", driverId: null, driverName: null, routeLabel: "San Martin a Bariloche" })
  ];

  it("busca por código, chofer o ruta sin distinguir tildes ni mayúsculas", () => {
    expect(filtrarIngresos(filas, { q: "chapelco" }).map((fila) => fila.id)).toEqual(["r1"]);
    expect(filtrarIngresos(filas, { q: "SILVIA" }).map((fila) => fila.id)).toEqual(["r2"]);
    expect(filtrarIngresos(filas, { q: "arc-3" }).map((fila) => fila.id)).toEqual(["r3"]);
  });

  it("filtra por chofer y deja aparte los que no tienen chofer", () => {
    expect(filtrarIngresos(filas, { driverId: "d1" }).map((fila) => fila.id)).toEqual(["r1"]);
    expect(filtrarIngresos(filas, { driverId: "sin-chofer" }).map((fila) => fila.id)).toEqual(["r3"]);
  });

  it("ordena por monto dentro de la misma moneda y pagina el resultado", () => {
    const ordenadas = ordenarIngresos(filas, { columna: "monto", direccion: "desc" });
    expect(ordenadas.map((fila) => fila.id)).toEqual(["r2", "r1", "r3"]);
    expect(paginar(ordenadas, 1, 2).items.map((fila) => fila.id)).toEqual(["r2", "r1"]);
    expect(paginar(ordenadas, 2, 2).items.map((fila) => fila.id)).toEqual(["r3"]);
  });

  it("usa el orden por defecto (fecha descendente) y acepta columnas repetidas en la URL", () => {
    expect(ordenarIngresos(filas, ORDEN_DE_INGRESOS_POR_DEFECTO).map((fila) => fila.id)).toEqual(["r1", "r2", "r3"]);
    expect(leerColumnasDeIngresos(["fecha", "monto"])).toEqual(["fecha", "monto"]);
    expect(leerColumnasDeIngresos(undefined)).toEqual(COLUMNAS_DE_INGRESOS_POR_DEFECTO);
  });

  it("sólo acepta tamaños de página conocidos", () => {
    expect(leerTamanoDePagina("50")).toBe(50);
    expect(leerTamanoDePagina("7")).toBe(25);
    expect(leerTamanoDePagina(undefined)).toBe(25);
  });
});
