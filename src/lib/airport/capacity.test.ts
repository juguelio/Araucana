import { describe, expect, it } from "vitest";
import { butacasParaAeropuerto, etiquetaCapacidad, resumenButacas, tienePlanoDeButacas } from "./capacity";

/**
 * #247: la capacidad de una unidad sale del plano de butacas y nada en el panel lo decía. Estas
 * funciones son el texto único que usan el listado de naves, el editor del plano y el buscador de
 * combis del vuelo, así que la regla del equipaje sigue viviendo en un solo lugar.
 */

describe("butacas que vende una unidad al aeropuerto", () => {
  it("las chicas dejan 4 para el equipaje y las grandes venden todas", () => {
    expect(butacasParaAeropuerto(25)).toBe(21);
    expect(butacasParaAeropuerto(19)).toBe(15);
    expect(butacasParaAeropuerto(26)).toBe(26);
    expect(butacasParaAeropuerto(45)).toBe(45);
  });

  it("sin plano cargado no hay capacidad", () => {
    expect(butacasParaAeropuerto(0)).toBe(0);
    expect(butacasParaAeropuerto(3)).toBe(0);
  });
});

describe("plano de butacas cargado", () => {
  it("0 butacas es «falta el plano», no un dato válido", () => {
    expect(tienePlanoDeButacas(0)).toBe(false);
    expect(tienePlanoDeButacas(1)).toBe(true);
  });
});

describe("texto de la columna Capacidad", () => {
  it("una unidad sin plano dice que falta cargar la capacidad", () => {
    expect(etiquetaCapacidad(0)).toBe("Falta cargar la capacidad");
  });

  it("con plano muestra los pasajeros, en singular y plural", () => {
    expect(etiquetaCapacidad(1)).toBe("1 pasajero");
    expect(etiquetaCapacidad(24)).toBe("24 pasajeros");
  });
});

describe("resumen del encabezado del editor", () => {
  it("muestra el total y lo que vende al aeropuerto", () => {
    expect(resumenButacas(24)).toBe("24 butacas · 20 para aeropuerto · 4 para equipaje");
  });

  it("las unidades grandes no resignan butacas", () => {
    expect(resumenButacas(44)).toBe("44 butacas · 44 para aeropuerto · todas para pasajeros");
  });

  it("sin butacas no inventa un número", () => {
    expect(resumenButacas(0)).toBe("Sin butacas cargadas");
  });
});
