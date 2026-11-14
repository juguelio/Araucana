import { describe, expect, it } from "vitest";
import {
  AEROPUERTO_CHAPELCO,
  largoDelRecorrido,
  ordenarPorRecorrido,
  whatsappDigitos,
  whatsappLink
} from "./route-order";

// Puntos reales alrededor de San Martín de los Andes, a distancias bien distintas del aeropuerto.
const centro = { id: "centro", latitude: -40.1570, longitude: -71.3530 };
const laIslita = { id: "la-islita", latitude: -40.1260, longitude: -71.2950 };
const catrite = { id: "catrite", latitude: -40.0810, longitude: -71.1520 };
const sinUbicacion = { id: "sin-ubicacion", latitude: null, longitude: null };

describe("orden del recorrido del chofer (pedido del cliente)", () => {
  it("encadena el retiro más cercano desde el aeropuerto en vez de ir por nombre", () => {
    // Orden alfabético: catrite, centro, la-islita → cruza la ciudad dos veces.
    const ordenado = ordenarPorRecorrido([centro, laIslita, catrite]);

    expect(ordenado.map((p) => p.id)).toEqual(["catrite", "la-islita", "centro"]);
  });

  it("recorre menos metros que el orden alfabético de la hoja actual", () => {
    const paradas = [centro, laIslita, catrite];
    const alfabetico = [...paradas].sort((a, b) => a.id.localeCompare(b.id, "es"));
    const optimizado = ordenarPorRecorrido(paradas);

    const metrosAntes = largoDelRecorrido(alfabetico, AEROPUERTO_CHAPELCO);
    const metrosDespues = largoDelRecorrido(optimizado, AEROPUERTO_CHAPELCO);

    expect(metrosDespues).toBeLessThan(metrosAntes);
  });

  it("deja al final los pasajeros sin ubicación, sin inventarles un punto", () => {
    const ordenado = ordenarPorRecorrido([sinUbicacion, centro, catrite]);

    expect(ordenado.at(-1)?.id).toBe("sin-ubicacion");
    expect(ordenado).toHaveLength(3);
  });

  it("acepta coordenadas anidadas (el pickup de la reserva)", () => {
    const pasajeros = [
      { nombre: "Centro", pickup: { latitude: centro.latitude, longitude: centro.longitude } },
      { nombre: "Catrite", pickup: { latitude: catrite.latitude, longitude: catrite.longitude } },
      { nombre: "Sin punto", pickup: null }
    ];

    const ordenado = ordenarPorRecorrido(pasajeros, (p) => p.pickup);

    expect(ordenado.map((p) => p.nombre)).toEqual(["Catrite", "Centro", "Sin punto"]);
  });

  it("no rompe con un día sin pasajeros", () => {
    expect(ordenarPorRecorrido([])).toEqual([]);
  });
});

describe("WhatsApp del pasajero para el chofer", () => {
  it("normaliza los formatos que se cargan en el panel", () => {
    expect(whatsappDigitos("+54 9 2944 12-3456")).toBe("5492944123456");
    // Con 54 pero sin el 9 de los móviles.
    expect(whatsappDigitos("+54 2944 123456")).toBe("5492944123456");
    // Sin país: se asume Argentina.
    expect(whatsappDigitos("2944 123456")).toBe("5492944123456");
  });

  it("arma el link que abre el chat", () => {
    expect(whatsappLink("+54 9 2944 123456")).toBe("https://wa.me/5492944123456");
  });

  it("no inventa un link con un número incompleto", () => {
    expect(whatsappLink("123")).toBeNull();
    expect(whatsappLink("")).toBeNull();
  });
});
