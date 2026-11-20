import { describe, expect, it } from "vitest";
import {
  AEROPUERTO_CHAPELCO,
  largoDelRecorrido,
  ordenarPorRecorrido,
  optimizarEntreExtremos,
  whatsappDigitos,
  whatsappLink
} from "./route-order";
import { distanceMeters } from "@/lib/driver/location";

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

describe("oficina → retiros → aeropuerto", () => {
  const oficina = { latitude: -40.158, longitude: -71.353 };
  const aeropuerto = AEROPUERTO_CHAPELCO;
  const punto = (id: string, latitude: number, longitude: number) => ({ id, latitude, longitude });
  const coords = (p: { latitude: number; longitude: number }) => p;
  const largo = (paradas: Array<typeof oficina>) => largoDelRecorrido(paradas, oficina)
    + (paradas.length ? distanceMeters(paradas.at(-1)!, aeropuerto) : distanceMeters(oficina, aeropuerto));

  it("recoge primero en la oficina, sin volver a buscar allí después de otros retiros", () => {
    const paradas = [punto("oeste", -40.161, -71.36), punto("este", -40.153, -71.34), { id: "oficina", ...oficina }];
    const copia = [...paradas];
    const resultado = optimizarEntreExtremos(paradas, coords, oficina, aeropuerto);
    expect(resultado.map((p) => p.id)).toEqual(["oficina", "oeste", "este"]);
    expect(paradas).toEqual(copia);
  });

  it("el cálculo exacto coincide con probar todos los órdenes, incluyendo el tramo al aeropuerto", () => {
    const puntos = [
      punto("a", -40.161, -71.36), punto("b", -40.16, -71.35), punto("c", -40.156, -71.349),
      punto("d", -40.15, -71.337), punto("e", -40.131, -71.296)
    ];
    const permutaciones = <T,>(items: T[]): T[][] => items.length < 2 ? [items]
      : items.flatMap((item, i) => permutaciones(items.filter((_, j) => i !== j)).map((resto) => [item, ...resto]));
    const minimo = Math.min(...permutaciones(puntos).map(largo));
    const resultado = optimizarEntreExtremos(puntos, coords, oficina, aeropuerto);
    expect(largo(resultado)).toBeCloseTo(minimo, 6);
    expect(resultado).toHaveLength(puntos.length);
    expect(new Set(resultado.map((p) => p.id)).size).toBe(puntos.length);
  });

  it("el destino cambia el orden: no cierra el circuito volviendo a la oficina", () => {
    const origen = { latitude: 0, longitude: 0 };
    const norte = punto("norte", 1, 0);
    const sur = punto("sur", -1, 0);
    expect(optimizarEntreExtremos([norte, sur], coords, origen, { latitude: 2, longitude: 0 }).map((p) => p.id)).toEqual(["sur", "norte"]);
    expect(optimizarEntreExtremos([norte, sur], coords, origen, { latitude: -2, longitude: 0 }).map((p) => p.id)).toEqual(["norte", "sur"]);
  });

  it("con más de 12 retiros mejora o iguala el orden anterior y no pierde paradas", () => {
    const puntos = Array.from({ length: 20 }, (_, i) => punto(String(i), -40.16 + ((i * 7) % 20) * 0.001, -71.36 + ((i * 13) % 20) * 0.002));
    const anterior = ordenarPorRecorrido(puntos, coords, aeropuerto).reverse();
    const nuevo = optimizarEntreExtremos(puntos, coords, oficina, aeropuerto);
    expect(largo(nuevo)).toBeLessThanOrEqual(largo(anterior) + 0.01);
    expect([...nuevo].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...puntos].sort((a, b) => a.id.localeCompare(b.id)));
    expect(optimizarEntreExtremos(puntos, coords, oficina, aeropuerto)).toEqual(nuevo);
  });

  it("mantiene los retiros sin coordenadas al final, sin inventar ubicaciones", () => {
    const paradas = [{ id: "sin1", punto: null }, { id: "este", punto: { latitude: -40.15, longitude: -71.34 } }, { id: "sin2", punto: null }];
    expect(optimizarEntreExtremos(paradas, (p) => p.punto, oficina, aeropuerto).map((p) => p.id)).toEqual(["este", "sin1", "sin2"]);
    expect(optimizarEntreExtremos([], coords, oficina, aeropuerto)).toEqual([]);
  });
});
