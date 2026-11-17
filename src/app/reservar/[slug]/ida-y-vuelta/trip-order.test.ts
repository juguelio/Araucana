import { describe, expect, it } from "vitest";
import { OPCIONES_DE_ORDEN, cambiarOrdenDeViaje } from "./trip-order";

describe("orden del viaje (#189)", () => {
  it("ofrece las dos opciones, cada una con sus dos patas", () => {
    expect(OPCIONES_DE_ORDEN.map((opcion) => opcion.valor)).toEqual(["ARRIVAL", "DEPARTURE"]);
    expect(OPCIONES_DE_ORDEN[0].titulo).toBe("Primero llego y después me voy");
    expect(OPCIONES_DE_ORDEN[0].ruta).toBe("CPC → SMA · SMA → CPC");
    expect(OPCIONES_DE_ORDEN[1].titulo).toBe("Primero me voy y después vuelvo");
    expect(OPCIONES_DE_ORDEN[1].ruta).toBe("SMA → CPC · CPC → SMA");
  });

  it("conserva fechas y vuelos cuando las dos fechas siguen en orden con el orden nuevo", () => {
    // Llegada 20 y salida 17: «primero me voy» deja la salida (17) antes que la llegada (20).
    const fechas = { llegada: "2026-11-20", vuelta: "2026-11-17" };
    const cambio = cambiarOrdenDeViaje("ARRIVAL", "DEPARTURE", fechas);
    expect(cambio.orden).toBe("DEPARTURE");
    expect(cambio.fechas).toBe(fechas);
    expect(cambio.limpiarVuelos).toBe(false);
    expect(cambio.aviso).toBe("");
  });

  it("da vuelta las fechas y avisa cuando el orden nuevo las dejaría al revés", () => {
    // La ida y vuelta normal (llego el 17, vuelvo el 20) leída como «primero me voy» invierte los días.
    const cambio = cambiarOrdenDeViaje("ARRIVAL", "DEPARTURE", { llegada: "2026-11-17", vuelta: "2026-11-20" });
    expect(cambio.orden).toBe("DEPARTURE");
    expect(cambio.fechas).toEqual({ llegada: "2026-11-20", vuelta: "2026-11-17" });
    expect(cambio.limpiarVuelos).toBe(true);
    expect(cambio.aviso.length).toBeGreaterThan(0);
  });

  it("también avisa al volver a «primero llego» con fechas invertidas", () => {
    const cambio = cambiarOrdenDeViaje("DEPARTURE", "ARRIVAL", { llegada: "2026-11-20", vuelta: "2026-11-17" });
    expect(cambio.orden).toBe("ARRIVAL");
    expect(cambio.fechas).toEqual({ llegada: "2026-11-17", vuelta: "2026-11-20" });
    expect(cambio.limpiarVuelos).toBe(true);
    expect(cambio.aviso.length).toBeGreaterThan(0);
  });

  it("no toca nada si se elige la opción que ya estaba", () => {
    const fechas = { llegada: "2026-11-20", vuelta: "2026-11-17" };
    const cambio = cambiarOrdenDeViaje("DEPARTURE", "DEPARTURE", fechas);
    expect(cambio.orden).toBe("DEPARTURE");
    expect(cambio.fechas).toBe(fechas);
    expect(cambio.limpiarVuelos).toBe(false);
    expect(cambio.aviso).toBe("");
  });

  it("con los dos tramos el mismo día conserva los vuelos al cambiar de orden", () => {
    const cambio = cambiarOrdenDeViaje("ARRIVAL", "DEPARTURE", { llegada: "2026-11-17", vuelta: "2026-11-17" });
    expect(cambio.orden).toBe("DEPARTURE");
    expect(cambio.limpiarVuelos).toBe(false);
    expect(cambio.aviso).toBe("");
  });
});
