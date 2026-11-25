import { describe, expect, it } from "vitest";
import { emptyLeg, legSchema } from "./data";

/**
 * #459: el cliente cargó coordenadas del mapa (`mapPoints`) directo en el JSON de los tramos, un
 * campo que la app no conoce. zod descarta las claves desconocidas al parsear, así que guardar el
 * viaje desde el panel borraba los puntos sin avisar.
 */
const mapPoints = [
  { location: { lat: -40.1573, lng: -71.3528 }, label: "Salida" },
  { location: { lat: -40.2201, lng: -71.4102 }, label: "Estancia" }
];

const tramo = {
  ...emptyLeg,
  origin: "San Martín de los Andes",
  destination: "Estancia Las Flores",
  included: true,
  description: "Traslado de pasajeros",
  // Lo que cargó el cliente y la app todavía no muestra en pantalla.
  mapPoints
};

describe("el tramo conserva los datos que la app no conoce", () => {
  it("mapPoints sobrevive al parseo de un tramo", () => {
    const parsed = legSchema.parse(tramo) as typeof tramo;
    expect(parsed.mapPoints).toEqual(mapPoints);
  });

  it("sobrevive al ida y vuelta del guardado (JSON → zod → JSON)", () => {
    // Lo que hace la action: JSON.parse del formulario, z.array(legSchema), y eso mismo a la base.
    const delFormulario = JSON.parse(JSON.stringify([tramo]));
    const guardado = JSON.parse(JSON.stringify([legSchema.parse(delFormulario[0])])) as typeof tramo[];
    expect(guardado[0].mapPoints).toHaveLength(2);
    expect(guardado[0].mapPoints[1].location).toEqual({ lat: -40.2201, lng: -71.4102 });
  });

  it("los campos conocidos se siguen validando igual", () => {
    expect(legSchema.safeParse({ ...tramo, country: "XX" }).success).toBe(false);
    expect(legSchema.safeParse({ ...tramo, description: "x".repeat(4001) }).success).toBe(false);
    expect(legSchema.safeParse({ ...tramo, origin: "x".repeat(501) }).success).toBe(false);
  });

  it("conserva también claves que todavía no existen en el código", () => {
    const futuro = { ...tramo, otroCampoDelCliente: { cualquier: "cosa" } } as Record<string, unknown>;
    expect(legSchema.parse(futuro)).toMatchObject({ otroCampoDelCliente: { cualquier: "cosa" } });
  });
});
